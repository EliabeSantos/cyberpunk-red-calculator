"use client";

/**
 * Entrada do modo online no layout atual: um item no nav da ficha
 * (**🌐 Mesa online**) que abre o painel com [CRIAR MESA] e [ENTRAR EM MESA].
 *
 * Criar/entrar NÃO navega para outra tela: a sala abre como painel por cima da
 * ficha (`MesaRoomDock`), então o jogador continua na sessão principal.
 *
 * Enquanto houver assinatura local, o botão do nav vira um indicador de
 * **conectado** (`● Mesa 8F4K2`) — visível mesmo com o painel fechado, porque
 * a conexão não depende do painel. Só sai quem clicar em "Sair" (ou quem for
 * derrubado pelo Mestre encerrar a sessão).
 *
 * Nada aqui substitui o modo local: a ficha, os dados e o inventário seguem
 * funcionando sem rede. Este componente só adiciona uma porta para a mesa.
 */

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createMesa, joinMesa, leaveMesa, MesaApiError } from "@/lib/mesa/client";
import { JOIN_CODE_PLACEHOLDER, normalizeJoinCode } from "@/lib/mesa/joinCode";
import {
  getMembershipSnapshot,
  getServerMembershipSnapshot,
  subscribeToMembership,
} from "@/lib/mesa/membershipStore";
import { openMesa } from "@/lib/mesa/mesaUiStore";
import { getActiveCharacter } from "@/lib/storage";

type Panel = "closed" | "home" | "create" | "join";

function defaultDisplayName(): string {
  const character = getActiveCharacter();
  return character?.identity.player || character?.identity.name || "";
}

export default function MesaEntry() {
  const [panel, setPanel] = useState<Panel>("closed");
  const [sessionName, setSessionName] = useState("");
  // Inicialização preguiçosa: este componente só monta depois do carregamento
  // da ficha no cliente, então não há risco de divergência de hidratação.
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await createMesa({ name: sessionName, displayName });
      setPanel("closed");
      // A sala abre como painel sobre a ficha: o jogador não sai desta tela.
      openMesa(result.session.joinCode);
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
      await joinMesa({ joinCode: code, displayName });
      setPanel("closed");
      openMesa(code);
    } catch (caught) {
      setError(caught instanceof MesaApiError ? caught.message : "Não foi possível entrar na mesa.");
      setBusy(false);
    }
  }

  function openKnownMesa(joinCode: string) {
    setPanel("closed");
    openMesa(joinCode);
  }

  /** Um dos dois caminhos de saída da mesa: o próprio jogador pede. */
  async function handleLeave(mesa: { sessionId: string; joinCode: string }) {
    if (!window.confirm(`Sair da mesa ${mesa.joinCode}? Para voltar você vai precisar do código.`)) return;
    setError(null);
    setBusy(true);
    try {
      await leaveMesa(mesa.sessionId, mesa.joinCode);
    } catch (caught) {
      setError(caught instanceof MesaApiError ? caught.message : "Não foi possível sair da mesa.");
    } finally {
      setBusy(false);
    }
  }

  const modal =
    panel !== "closed"
      ? createPortal(
          <div className="mesa-modal-backdrop" onClick={() => setPanel("closed")}>
            <div className="mesa-modal" onClick={(event) => event.stopPropagation()}>
              <header className="mesa-modal-header">
                <div>
                  <span className="mesa-eyebrow">MODO ONLINE</span>
                  <h2>{panel === "create" ? "Criar mesa" : panel === "join" ? "Entrar em mesa" : "Mesa online"}</h2>
                </div>
                <button type="button" className="mesa-close" onClick={() => setPanel("closed")} aria-label="Fechar">
                  ×
                </button>
              </header>

              {error && <p className="mesa-error">{error}</p>}

              {panel === "home" && (
                <div className="mesa-home">
                  <p className="mesa-hint">
                    Jogue Cyberpunk RED com sua mesa em tempo real. O modo local continua funcionando normalmente.
                  </p>
                  <button type="button" className="mesa-primary" onClick={() => setPanel("create")}>
                    [ CRIAR MESA ]
                  </button>
                  <button type="button" className="mesa-secondary" onClick={() => setPanel("join")}>
                    [ ENTRAR EM MESA ]
                  </button>

                  {mesas.length > 0 && (
                    <section className="mesa-known">
                      <h3>Suas mesas</h3>
                      <p className="mesa-hint">
                        Você continua conectado a estas mesas mesmo com o painel fechado — só sai clicando em{" "}
                        <b>Sair</b> ou quando o Mestre encerrar a sessão.
                      </p>
                      <ul>
                        {mesas.map((mesa) => (
                          <li key={mesa.sessionId} className="mesa-known-row">
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
                              onClick={() => void handleLeave(mesa)}
                            >
                              Sair
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </div>
              )}

              {panel === "create" && (
                <form className="mesa-form" onSubmit={handleCreate}>
                  <label>
                    Nome da mesa
                    <input
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
                  <button type="submit" className="mesa-primary" disabled={busy || !sessionName.trim() || !displayName.trim()}>
                    {busy ? "Criando..." : "[ CRIAR MESA ]"}
                  </button>
                  <button type="button" className="mesa-ghost" onClick={() => setPanel("home")}>
                    Voltar
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
                  <button type="submit" className="mesa-primary" disabled={busy || !displayName.trim()}>
                    {busy ? "Entrando..." : "[ ENTRAR EM MESA ]"}
                  </button>
                  <button type="button" className="mesa-ghost" onClick={() => setPanel("home")}>
                    Voltar
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
        className={activeCode ? "mesa-nav-connected" : undefined}
        onClick={() => setPanel("home")}
      >
        {activeCode ? `● Mesa ${activeCode}` : "🌐 Mesa online"}
      </button>

      {modal}
    </>
  );
}
