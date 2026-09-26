"use client";

/**
 * Sala da Mesa — lobby e combate compartilhado, renderizada como PAINEL por
 * cima da tela principal (não é mais uma rota própria).
 *
 * Fluxo do GM → SESSION → COMBAT → PLAYER:
 *   GM cria a mesa → jogadores entram pelo código → cada um vincula a ficha →
 *   GM inicia combate (pela tela de Encontros) → GM rola iniciativa → turnos
 *   avançam com 2 Actions e MOVE × 2 metros cada → todos recebem o mesmo
 *   estado por Realtime.
 *
 * CONEXÃO: fechar este painel não desconecta — a assinatura fica no
 * `membershipStore` e o jogador segue na mesa (o nav mostra `● Mesa 8F4K2`).
 * Só há dois caminhos de saída: o jogador clicar em "Sair da mesa" (aqui ou
 * no nav) e o Mestre encerrar a sessão.
 *
 * O modo local não é afetado: nada aqui toca nas fichas salvas, exceto quando
 * o jogador escolhe vincular uma (a cópia vai para o servidor, a original fica).
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import MesaCombatPanel from "@/components/mesa/MesaCombatPanel";
import { joinMesa, leaveMesa, linkCharacter, MesaApiError } from "@/lib/mesa/client";
import { normalizeJoinCode } from "@/lib/mesa/joinCode";
import {
  getMembershipSnapshot,
  getServerMembershipSnapshot,
  removeMembership,
  subscribeToMembership,
} from "@/lib/mesa/membershipStore";
import type { MesaState } from "@/lib/mesa/types";
import { useMesaState } from "@/lib/mesa/useMesaState";
import { getActiveCharacter, loadCharacters } from "@/lib/storage";

interface Props {
  joinCode: string;
  /** Fecha o painel e devolve o jogador à tela que estava por baixo. */
  onClose?: () => void;
}

export default function MesaRoom({ joinCode, onClose }: Props) {
  const normalizedCode = useMemo(() => normalizeJoinCode(joinCode) ?? joinCode.toUpperCase(), [joinCode]);

  // localStorage não existe no servidor: o servidor lê o snapshot vazio e o
  // cliente só troca depois da hidratação — sem efeito e sem divergência de HTML.
  const membershipStore = useSyncExternalStore(
    subscribeToMembership,
    getMembershipSnapshot,
    getServerMembershipSnapshot,
  );
  const membership = membershipStore.entries[normalizedCode] ?? null;

  const [displayName, setDisplayName] = useState("");
  const [joining, setJoining] = useState(false);
  const [notice, setNotice] = useState<{ message: string; kind: "error" | "ok" } | null>(null);

  const sessionId = membership?.sessionId ?? null;
  const { state, loading, error, errorCode, realtime, refresh } = useMesaState(sessionId);

  const onNotice = useCallback((message: string, kind: "error" | "ok") => {
    setNotice({ message, kind });
    window.setTimeout(() => setNotice(null), 5000);
  }, []);

  const onChanged = useCallback(async () => {
    await refresh();
  }, [refresh]);

  // Conexão da mesa é independente do painel: fechar o painel não desconecta.
  // Só há dois caminhos de saída — o jogador clicar em "Sair da mesa" ou o
  // Mestre encerrar a sessão (aqui). Também cai fora se esta assinatura já
  // não existir no servidor (saiu em outra aba).
  const disconnectRef = useRef(false);
  useEffect(() => {
    if (disconnectRef.current) return;
    // `viewer` não serve como sinal: um broadcast do Realtime pode chegar antes
    // do primeiro GET e trazer viewer nulo. Os dois sinais abaixo são conclusivos.
    const sessionClosed = state?.session.status === "finished";
    const noLongerParticipant = errorCode === "not_participant";
    if (!sessionClosed && !noLongerParticipant) return;
    disconnectRef.current = true;
    removeMembership(normalizedCode);
    onClose?.();
  }, [state, errorCode, normalizedCode, onClose]);

  // Vincula automaticamente a ficha ativa quando o jogador ainda não escolheu uma.
  // Uma tentativa por sessão: se falhar, o jogador escolhe manualmente abaixo.
  const attemptedLinkRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state) return;
    const me = state.participants.find((entry) => entry.id === state.viewer.participantId);
    if (!me || me.characterId) return;
    if (attemptedLinkRef.current === state.session.id) return;
    const character = getActiveCharacter();
    if (!character) return;
    attemptedLinkRef.current = state.session.id;
    void linkCharacter(state.session.id, character.id, character)
      .then(() => refresh())
      .catch(() => {
        // Sem ficha local ou falha de rede: o jogador pode escolher abaixo.
      });
  }, [state, refresh]);

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    const code = normalizeJoinCode(normalizedCode);
    if (!code) {
      onNotice("Código de mesa inválido.", "error");
      return;
    }
    setJoining(true);
    try {
      // `joinMesa` grava a assinatura no store: a tela troca sozinha (useSyncExternalStore).
      await joinMesa({ joinCode: code, displayName });
    } catch (caught) {
      onNotice(caught instanceof MesaApiError ? caught.message : "Não foi possível entrar.", "error");
    } finally {
      setJoining(false);
    }
  }

  if (!sessionId) {
    return (
      <div className="mesa-shell mesa-shell-standalone">
        <section className="mesa-panel mesa-join">
          <span className="mesa-eyebrow">MESA</span>
          <h1>Entrar na mesa {normalizedCode}</h1>
          <p className="mesa-hint">Informe o seu nome para entrar. Nenhuma conta é necessária.</p>
          <form className="mesa-form" onSubmit={handleJoin}>
            <label>
              Seu nome na mesa
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Zuberi"
                maxLength={40}
                autoFocus
              />
            </label>
            <button type="submit" className="mesa-primary" disabled={joining || !displayName.trim()}>
              {joining ? "Entrando..." : "[ ENTRAR EM MESA ]"}
            </button>
          </form>
          {onClose ? (
            <button type="button" className="mesa-ghost" onClick={onClose}>
              ← Voltar à ficha
            </button>
          ) : (
            <Link className="mesa-ghost" href="/">
              ← Voltar à ficha
            </Link>
          )}
        </section>
      </div>
    );
  }

  if (error && !state) {
    return (
      <div className="mesa-shell mesa-shell-standalone">
        <section className="mesa-panel">
          <h1>Não foi possível abrir a mesa</h1>
          <p className="mesa-error">{error}</p>
          <button type="button" className="mesa-ghost" onClick={() => void refresh()}>
            Tentar de novo
          </button>
          {onClose && (
            <button type="button" className="mesa-ghost" onClick={onClose}>
              ← Voltar à ficha
            </button>
          )}
        </section>
      </div>
    );
  }

  if (loading || !state || !sessionId) {
    return <div className="mesa-shell mesa-shell-standalone loading-screen">Sincronizando mesa...</div>;
  }

  return (
    <MesaView
      sessionId={sessionId}
      state={state}
      joinCode={normalizedCode}
      realtime={realtime}
      notice={notice}
      onNotice={onNotice}
      onChanged={onChanged}
      onRefresh={refresh}
      onClose={onClose}
    />
  );
}

interface ViewProps {
  sessionId: string;
  state: MesaState;
  joinCode: string;
  realtime: boolean;
  notice: { message: string; kind: "error" | "ok" } | null;
  onNotice: (message: string, kind: "error" | "ok") => void;
  onChanged: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onClose?: () => void;
}

function listLocalCharacters(): Array<{ id: string; name: string }> {
  return loadCharacters().map((character) => ({
    id: character.id,
    name: character.identity.name || "Sem nome",
  }));
}

function MesaView({ sessionId, state, joinCode, realtime, notice, onNotice, onChanged, onRefresh, onClose }: ViewProps) {
  // Inicialização preguiçosa: `MesaView` só renderiza depois do estado chegar
  // do servidor, ou seja, já está no navegador — não há hidratação a casar.
  const [characters] = useState(listLocalCharacters);
  const [linking, setLinking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [inviteLink] = useState(() => `${window.location.origin}/mesa/${joinCode}`);

  const isGM = state.viewer.role === "gm";
  const me = state.participants.find((entry) => entry.id === state.viewer.participantId) ?? null;
  const sessionFinished = state.session.status === "finished";

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      onNotice("Link de convite copiado.", "ok");
    } catch {
      onNotice(`Convite: ${inviteLink}`, "ok");
    }
  }

  /**
   * Desconexão manual — um dos dois caminhos de saída da mesa (o outro é o
   * Mestre encerrar a sessão). Sai no servidor e apaga a assinatura local.
   */
  async function handleLeave() {
    if (!window.confirm("Sair da mesa? Para voltar você vai precisar do código de novo.")) return;
    setLeaving(true);
    try {
      await leaveMesa(sessionId, joinCode);
      onClose?.();
    } catch (caught) {
      onNotice(caught instanceof MesaApiError ? caught.message : "Não foi possível sair da mesa.", "error");
      setLeaving(false);
    }
  }

  async function handleLink(characterId: string) {
    if (!characterId) return;
    setLinking(true);
    try {
      const character = loadCharacters().find((entry) => entry.id === characterId);
      if (!character) throw new MesaApiError("Personagem não encontrado no navegador.", 400, "not_found");
      await linkCharacter(sessionId, character.id, character);
      await onRefresh();
      onNotice(`Ficha "${character.identity.name}" vinculada.`, "ok");
    } catch (caught) {
      onNotice(caught instanceof MesaApiError ? caught.message : "Falha ao vincular a ficha.", "error");
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="mesa-shell">
      <header className="mesa-header">
        <div className="mesa-title">
          <span className="mesa-eyebrow">MESA</span>
          <h1>{state.session.name}</h1>
          <div className="mesa-code">
            <span>Código:</span>
            <strong>{state.session.joinCode}</strong>
          </div>
        </div>

        <div className="mesa-header-meta">
          <span className={`mesa-badge status-${state.session.status}`}>{state.session.status.toUpperCase()}</span>
          <span className={`mesa-badge ${realtime ? "is-live" : ""}`}>
            {realtime ? "● AO VIVO" : "◌ SINCRONIZANDO"}
          </span>
          <button type="button" className="mesa-ghost" onClick={() => void copyInvite()}>
            Copiar link
          </button>
          {onClose && (
            <button type="button" className="mesa-ghost" onClick={onClose}>
              ✕ Fechar
            </button>
          )}
        </div>
      </header>

      <p className="mesa-invite">
        Convite: <code>{inviteLink}</code>
      </p>

      {notice && <p className={`mesa-notice ${notice.kind}`}>{notice.message}</p>}

      <section className="mesa-panel">
        <h2 className="mesa-panel-title">Jogadores</h2>
        <ul className="mesa-players">
          {state.participants.map((participant) => (
            <li key={participant.id} className={participant.id === state.viewer.participantId ? "is-you" : ""}>
              <span className="mesa-dot" />
              <strong>{participant.displayName}</strong>
              <span className="mesa-role">{participant.role === "gm" ? "Mestre" : "Jogador"}</span>
              <span className="mesa-char">{participant.characterId ? "ficha vinculada" : "sem ficha"}</span>
            </li>
          ))}
        </ul>

        <div className="mesa-link-character">
          <label>
            Meu personagem nesta mesa
            <select
              value={me?.characterId ?? ""}
              disabled={linking || sessionFinished}
              onChange={(event) => void handleLink(event.target.value)}
            >
              <option value="">— nenhum —</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          </label>
          <small>
            A ficha continua no seu navegador. Só uma cópia vai para o servidor, para o mestre validar as ações.
          </small>
        </div>
      </section>

      <MesaCombatPanel
        sessionId={sessionId}
        state={state}
        isGM={isGM}
        sessionFinished={sessionFinished}
        onNotice={onNotice}
        onChanged={onChanged}
      />

      <footer className="mesa-footer">
        <span>
          {isGM ? "Você é o Mestre desta mesa." : `Conectado como ${state.viewer.displayName ?? "jogador"}.`}
        </span>
        {isGM && !sessionFinished ? (
          <span className="mesa-footer-hint">Para se desconectar, encerre a sessão.</span>
        ) : (
          <button
            type="button"
            className="mesa-ghost mesa-leave"
            disabled={leaving}
            onClick={() => void handleLeave()}
          >
            {leaving ? "Saindo..." : "Sair da mesa"}
          </button>
        )}
      </footer>
    </div>
  );
}
