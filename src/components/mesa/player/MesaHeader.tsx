"use client";

/**
 * F1.12.3 — cabeçalho da tela do Player: identidade da Mesa, estado da sessão
 * e QUALIDADE DA CONEXÃO (Realtime vs. polling de reconexão).
 */

import Link from "next/link";

import type { MesaState } from "@/lib/mesa/types";
import type { NoticeFn } from "./types";

interface Props {
  state: MesaState;
  realtime: boolean;
  leaving: boolean;
  busy: boolean;
  onNotice: NoticeFn;
  onLeave: () => void;
  onEndCombat: () => void;
}

export default function MesaHeader({ state, realtime, leaving, busy, onNotice, onLeave, onEndCombat }: Props) {
  const finished = state.session.status === "finished";
  const isGM = state.viewer.role === "gm";
  const combatActive = state.combat?.status === "active";

  async function copyInvite() {
    const link = `${window.location.origin}/mesa/${state.session.joinCode}`;
    try {
      await navigator.clipboard.writeText(link);
      onNotice("Link de convite copiado.", "ok");
    } catch {
      onNotice(`Convite: ${link}`, "ok");
    }
  }

  return (
    <header className="player-mesa-header">
      <div>
        <span className="mesa-eyebrow">MESA ONLINE</span>
        <h1>{state.session.name}</h1>
        <p className="player-mesa-subtitle">
          {state.viewer.displayName ?? "Jogador"} · código <b>{state.session.joinCode}</b>
        </p>
      </div>

      <div className="player-mesa-header-meta">
        <span className={`mesa-badge status-${state.session.status}`}>
          {finished ? "ENCERRADA" : state.session.status.toUpperCase()}
        </span>
        <span
          className={`mesa-badge ${realtime ? "is-live" : ""}`}
          title={
            realtime
              ? "Realtime conectado: as mudanças chegam instantaneamente."
              : "Realtime indisponível — atualizando por polling a cada 4s."
          }
        >
          {realtime ? "● AO VIVO" : "◌ RECONECTANDO"}
        </span>
        <button type="button" className="mesa-ghost" onClick={() => void copyInvite()}>
          Copiar convite
        </button>
        {isGM && combatActive && (
          <button
            type="button"
            className="mesa-ghost mesa-header-end-combat"
            disabled={busy}
            onClick={onEndCombat}
            title="Encerrar o combate atual para todos os participantes."
          >
            {busy ? "Encerrando..." : "Encerrar combate"}
          </button>
        )}
        <Link className="mesa-ghost" href="/">
          Ficha
        </Link>
        <button
          type="button"
          className="mesa-ghost"
          disabled={leaving}
          onClick={onLeave}
          title="Sair da mesa. Para voltar você vai precisar do código."
        >
          {leaving ? "Saindo..." : "Sair da mesa"}
        </button>
      </div>
    </header>
  );
}
