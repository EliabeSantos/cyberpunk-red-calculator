"use client";

/**
 * Entrada do modo online no layout atual: um item no nav da ficha
 * (**Mesa online**) que, no fluxo de entrada, abre o modal de conexão — duas
 * rotas ("Criar uma mesa" e "Entrar com código") no formato de painel de
 * operador, com as mesas deste navegador listadas embaixo.
 *
 * O modal é um diálogo de verdade: fecha no ESC, no clique no fundo e no ✕,
 * trava o scroll da página enquanto está aberto e devolve o foco para quem o
 * abriu.
 *
 * F1.12.7 — o botão PRIMEIRO pergunta se há Mesa ativa (ver `resolveActiveMesa`):
 *
 *     clica "Mesa" → Mesa ativa de JOGADOR confirmada?  SIM → /mesa/<sessionId>
 *                                               (modal NÃO é renderizado)
 *                                                  NÃO → fluxo de sempre, abaixo
 *
 * A assinatura que decide é a mesma de sempre (`membershipStore`): nenhuma
 * cópia de Mesa é criada aqui. Se ela estiver expirada/encerrada, a limpeza é a
 * infraestrutura existente (`removeMembership`) e o jogador cai no fluxo de
 * entrada — nunca num redirect para uma Mesa inválida. O Mestre segue abrindo o
 * dock, que é onde os controles dele moram.
 *
 * Criar/entrar navega para a tela dedicada da Mesa assim que a sessão existe.
 *
 * Enquanto houver assinatura local, o botão do nav vira um indicador de
 * **conectado** (`● Mesa 8F4K2`) — visível mesmo com o painel fechado, porque
 * a conexão não depende do painel. Só sai quem clicar em "Sair" (ou quem for
 * derrubado pelo Mestre encerrar a sessão). No cabeçalho do modal o mesmo
 * estado aparece como chip de status (`SEM SESSÃO` / `CONECTADO · 8F4K2`).
 *
 * O botão é um item de menu como outro qualquer (ícone + rótulo, sem emoji);
 * fora da mesa o ícone é o de transmissão, e ao conectar ele vira um ponto
 * aceso.
 *
 * Nada aqui substitui o modo local: a ficha, os dados e o inventário seguem
 * funcionando sem rede. Este componente só adiciona uma porta para a mesa.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { resolveActiveMesa } from "@/lib/mesa/activeMesa";
import { closeMesa, createMesa, joinMesa, leaveMesa, MesaApiError } from "@/lib/mesa/client";
import { defaultMesaDisplayName } from "@/lib/mesa/displayName";
import { JOIN_CODE_PLACEHOLDER, normalizeJoinCode } from "@/lib/mesa/joinCode";
import {
  getMembershipSnapshot,
  getServerMembershipSnapshot,
  subscribeToMembership,
} from "@/lib/mesa/membershipStore";
import { playerMesaHref } from "@/lib/mesa/mesaRoute";
import { ArrowLeftIcon, ChevronRightIcon, PlusIcon, RadioIcon, XIcon } from "@/components/icons";
import AppDialog from "@/components/AppDialog";
import { getConfiguredMesaServerUrl, isElectronRenderer, setConfiguredMesaServerUrl } from "@/lib/mesa/remoteServer";

type Panel = "closed" | "home" | "create" | "join";

export default function MesaEntry() {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>("closed");
  const [sessionName, setSessionName] = useState("");
  // Inicialização preguiçosa: este componente só monta depois do carregamento
  // da ficha no cliente, então não há risco de divergência de hidratação.
  const [displayName, setDisplayName] = useState(defaultMesaDisplayName);
  const [joinCode, setJoinCode] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState<{ sessionId: string; joinCode: string; role: "gm" | "player" } | null>(null);
  const [electronRenderer, setElectronRenderer] = useState(false);

  useEffect(() => {
    setElectronRenderer(isElectronRenderer());
    setServerUrl(getConfiguredMesaServerUrl() ?? "");
  }, []);

  // Lista REATIVA das mesas deste navegador (mudou → re-render, sem efeito).
  const membershipStore = useSyncExternalStore(
    subscribeToMembership,
    getMembershipSnapshot,
    getServerMembershipSnapshot,
  );
  const mesas = Object.entries(membershipStore.entries).map(([code, entry]) => ({ joinCode: code, ...entry }));
  const activeCode =
    membershipStore.activeJoinCode && membershipStore.entries[membershipStore.activeJoinCode]
      ? membershipStore.activeJoinCode
      : null;

  const isOpen = panel !== "closed";
  const triggerRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const createNameRef = useRef<HTMLInputElement>(null);
  const previousPanel = useRef<Panel>("closed");
  /** Trava contra duplo clique enquanto a checagem da Mesa ativa não responde. */
  const openingRef = useRef(false);

  // O modal se comporta como diálogo: ESC fecha, o fundo trava o scroll da
  // página e o foco volta para o botão que o abriu (navegar entre os painéis
  // internos não mexe no foco).
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPanel("closed");
    }
    document.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  // O foco entra no diálogo quando ele abre e quando um sub-painel volta para a
  // home (sem isso o foco escaparia para o corpo da página). Nos formulários o
  // primeiro campo já recebe o foco sozinho via `autoFocus`.
  useEffect(() => {
    if (isOpen && panel === "home") modalRef.current?.focus();
    if (isOpen && panel === "create") {
      const frame = window.requestAnimationFrame(() => createNameRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
  }, [isOpen, panel]);

  useEffect(() => {
    if (previousPanel.current !== "closed" && panel === "closed") triggerRef.current?.focus();
    previousPanel.current = panel;
  }, [panel]);

  /**
   * Botão principal do nav: decide entre a tela da Mesa e o fluxo de entrada.
   *
   * A checagem é um `GET` do MESMO estado que a tela do Player leria; só depois
   * de saber o resultado é que algo é renderizado — com Mesa ativa o modal nunca
   * chega a montar (`panel` continua `"closed"`), então não há flash de modal
   * antes do redirect.
   *
   * `router.push` (não `replace`): o mesmo padrão do link "Abrir tela da mesa"
   * da tela dedicada — o jogador precisa conseguir voltar para a ficha pelo
   * histórico. O `replace` ficou reservado para o redirect do convite
   * `/mesa/<CODE>` (F1.12.6), onde voltar ao convite criaria um laço.
   */
  async function handleOpenMesa() {
    if (openingRef.current) return;
    openingRef.current = true;
    try {
      const decision = await resolveActiveMesa();
      if (decision.kind === "navigate") {
        router.push(decision.href);
        return;
      }
      setPanel("home");
    } catch {
      // `resolveActiveMesa` nunca lança; mesmo assim o botão não pode ficar morto.
      setPanel("home");
    } finally {
      openingRef.current = false;
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await createMesa({ name: sessionName, displayName });
      setPanel("closed");
      router.push(playerMesaHref(result.session.id));
    } catch (caught) {
      setError(caught instanceof MesaApiError ? caught.message : "Não foi possível criar a mesa.");
      setBusy(false);
    }
  }

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    const code = normalizeJoinCode(joinCode);
    if (!code) {
      setError("Código inválido. Use 5 caracteres, ex.: 8F4K2.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (electronRenderer) {
        const configuredServerUrl = setConfiguredMesaServerUrl(serverUrl);
        if (serverUrl.trim() && !configuredServerUrl) {
          setError("Servidor remoto inválido. Use uma URL HTTP ou HTTPS, sem usuário ou senha.");
          setBusy(false);
          return;
        }
      }
      const result = await joinMesa({ joinCode: code, displayName });
      setPanel("closed");
      router.push(playerMesaHref(result.session.id));
    } catch (caught) {
      setError(caught instanceof MesaApiError ? caught.message : "Não foi possível entrar na mesa.");
      setBusy(false);
    }
  }

  function openKnownMesa(joinCode: string) {
    setPanel("closed");
    const mesa = mesas.find((entry) => entry.joinCode === joinCode);
    if (mesa) router.push(playerMesaHref(mesa.sessionId));
  }

  /** Um dos dois caminhos de saída da mesa: o próprio jogador pede. */
  async function confirmLeave() {
    if (!leaveTarget) return;
    const mesa = leaveTarget;
    setLeaveTarget(null);
    setError(null);
    setBusy(true);
    try {
      if (mesa.role === "gm") await closeMesa(mesa.sessionId, mesa.joinCode);
      else await leaveMesa(mesa.sessionId, mesa.joinCode);
    } catch (caught) {
      setError(caught instanceof MesaApiError ? caught.message : "Não foi possível sair da mesa.");
    } finally {
      setBusy(false);
    }
  }

  const modal =
    isOpen
      ? createPortal(
          <div className="mesa-modal-backdrop" onClick={() => setPanel("closed")}>
            <div
              className="mesa-modal"
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="mesa-modal-title"
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
            >
              <header className="mesa-modal-header">
                <div className="mesa-modal-heading">
                  {panel !== "home" && (
                    <button type="button" className="mesa-back" aria-label="Voltar" onClick={() => setPanel("home")}>
                      <ArrowLeftIcon />
                    </button>
                  )}
                  <div>
                    <span className={activeCode ? "mesa-status is-live" : "mesa-status"}>
                      <span className="mesa-status-dot" aria-hidden="true" />
                      {activeCode ? `Conectado · ${activeCode}` : "Sem conexão"}
                    </span>
                    <h2 id="mesa-modal-title">
                      {panel === "create" ? "Criar mesa" : panel === "join" ? "Entrar em mesa" : "Mesa online"}
                    </h2>
                  </div>
                </div>
                <button type="button" className="mesa-close" aria-label="Fechar" onClick={() => setPanel("closed")}>
                  <XIcon />
                </button>
              </header>

              {error && (
                <p className="mesa-error" role="alert">
                  {error}
                </p>
              )}

              {panel === "home" && (
                <div className="mesa-home">
                  <button type="button" className="mesa-route" onClick={() => setPanel("create")}>
                    <span className="mesa-route-icon">
                      <PlusIcon />
                    </span>
                    <span className="mesa-route-text">
                      <strong>Criar uma mesa</strong>
                      <small>Abre uma sessão nova e mostra o código.</small>
                    </span>
                    <span className="mesa-route-go">
                      <ChevronRightIcon />
                    </span>
                  </button>

                  <button type="button" className="mesa-route" onClick={() => setPanel("join")}>
                    <span className="mesa-route-icon">
                      <RadioIcon />
                    </span>
                    <span className="mesa-route-text">
                      <strong>Entrar com código</strong>
                      <small>Use os 5 caracteres que o Mestre compartilhou.</small>
                    </span>
                    <span className="mesa-route-go">
                      <ChevronRightIcon />
                    </span>
                  </button>

                  {mesas.length > 0 && (
                    <section className="mesa-known">
                      <h3>Suas mesas</h3>
                      <ul>
                        {mesas.map((mesa) => (
                          <li
                            key={mesa.sessionId}
                            className={mesa.joinCode === activeCode ? "mesa-known-row is-active" : "mesa-known-row"}
                          >
                            <button type="button" onClick={() => openKnownMesa(mesa.joinCode)}>
                              <strong>{mesa.joinCode}</strong>
                              <span>
                                {mesa.role === "gm" ? "Mestre" : "Jogador"}
                                {mesa.joinCode === activeCode ? " · ativa" : ""}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="mesa-known-leave"
                              disabled={busy}
                               onClick={() => setLeaveTarget(mesa)}
                            >
                              Sair
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  <p className="mesa-footnote">O modo local continua funcionando sem rede.</p>
                </div>
              )}

              {panel === "create" && (
                <form className="mesa-form" onSubmit={handleCreate}>
                  <label>
                    Nome da mesa
                    <input
                      ref={createNameRef}
                      value={sessionName}
                      onChange={(event) => setSessionName(event.target.value)}
                      placeholder="Heywood"
                      maxLength={60}
                      autoFocus
                    />
                  </label>
                  <label>
                    Seu nome na mesa
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="Zuberi"
                      maxLength={40}
                    />
                  </label>
                  <button
                    type="submit"
                    className="mesa-primary"
                    disabled={busy || !sessionName.trim() || !displayName.trim()}
                  >
                    {busy ? "Criando..." : "Criar mesa"}
                  </button>
                </form>
              )}

              {panel === "join" && (
                <form className="mesa-form" onSubmit={handleJoin}>
                  <label>
                    Código da mesa
                    <input
                      value={joinCode}
                      onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                      placeholder={JOIN_CODE_PLACEHOLDER}
                      maxLength={5}
                      className="mesa-code-input"
                      autoComplete="off"
                      spellCheck={false}
                      autoFocus
                    />
                  </label>
                  <label>
                    Seu nome na mesa
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="Zuberi"
                      maxLength={40}
                    />
                  </label>
                  {electronRenderer && (
                    <label>
                      Servidor da mesa (opcional)
                      <input
                        value={serverUrl}
                        onChange={(event) => setServerUrl(event.target.value)}
                        placeholder="http://26.50.194.224:3001"
                        inputMode="url"
                        autoComplete="url"
                      />
                      <small>Informe o IP do anfitrião para procurar o convite nele. Vazio usa este PC.</small>
                    </label>
                  )}
                  <button type="submit" className="mesa-primary" disabled={busy || !displayName.trim()}>
                    {busy ? "Entrando..." : "Entrar na mesa"}
                  </button>
                </form>
              )}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={activeCode ? "mesa-nav-connected" : undefined}
        onClick={() => void handleOpenMesa()}
      >
        <span className="mesa-nav-icon" aria-hidden="true">
          {activeCode ? <span className="mesa-nav-dot" /> : <RadioIcon />}
        </span>
        <span>{activeCode ? `Mesa ${activeCode}` : "Mesa online"}</span>
      </button>

      {modal}
      <AppDialog
        open={leaveTarget !== null}
        kind="confirm"
        title={leaveTarget?.role === "gm" ? "Encerrar mesa?" : "Sair da mesa?"}
        message={leaveTarget?.role === "gm" ? `O estado de ${leaveTarget.joinCode} será salvo e ficará disponível apenas para histórico.` : `Para voltar à mesa ${leaveTarget?.joinCode}, você precisará do código novamente.`}
        confirmLabel={leaveTarget?.role === "gm" ? "Encerrar mesa" : "Sair da mesa"}
        onConfirm={() => void confirmLeave()}
        onCancel={() => setLeaveTarget(null)}
      />
    </>
  );
}
