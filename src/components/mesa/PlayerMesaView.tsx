"use client";

/**
 * F1.12.3 — porta de entrada de `/mesa/[id]`.
 *
 * Responsabilidade reduzida de propósito: este bloco só resolve MEMBROSHIP +
 * carregamento (existe assinatura? o estado chegou? erro/retry?) e entrega o
 * snapshot para `PlayerMesaScreen`, que é a tela de jogo em si.
 *
 * Antes desta etapa a tela inteira vivia aqui (estado, ataques, recarga,
 * eventos). Separar deixa a experiência reutilizável e testável sem misturar
 * "como conectar" com "o que o jogador faz".
 */

import Link from "next/link";
import { useSyncExternalStore } from "react";

import PlayerMesaScreen from "@/components/mesa/player/PlayerMesaScreen";
import {
  getMembershipSnapshot,
  getServerMembershipSnapshot,
  subscribeToMembership,
} from "@/lib/mesa/membershipStore";
import { useMesaState } from "@/lib/mesa/useMesaState";

interface Props {
  sessionId: string;
}

function errorText(error: string | null, code: string | null): string {
  if (code === "not_participant") return "Você não está nesta Mesa.";
  if (code === "missing_token") return "Sua sessão de acesso à Mesa expirou. Entre novamente pelo código da Mesa.";
  if (code === "session_not_found") return "Esta Mesa não está mais disponível. Ela pode ter sido removida.";
  if (code === "session_finished") return "Esta Mesa foi encerrada.";
  if (code === "database_error" || code === "database_not_configured") return "O serviço está temporariamente indisponível. Tente novamente em instantes.";
  if (code === "internal_error") return "Ocorreu um erro interno ao carregar a Mesa. Tente novamente.";
  return error ?? "Não foi possível carregar a Mesa.";
}

function isTerminalError(code: string | null): boolean {
  return code === "missing_token" || code === "not_participant" || code === "session_not_found" || code === "session_finished";
}

export default function PlayerMesaView({ sessionId }: Props) {
  const memberships = useSyncExternalStore(
    subscribeToMembership,
    getMembershipSnapshot,
    getServerMembershipSnapshot,
  );
  const membership = Object.values(memberships.entries).find((entry) => entry.sessionId === sessionId) ?? null;
  const { state, loading, error, errorCode, realtime, refresh, getRefreshVersion } = useMesaState(membership ? sessionId : null);

  if (!membership) {
    return (
      <PlayerStateShell
        title="Mesa"
        message="Este navegador não está nesta Mesa. Peça o código ao Mestre e entre por “Mesa online” na ficha."
        retry={null}
      />
    );
  }
  if (loading && !state) {
    return <MesaLoadingSkeleton />;
  }
  if (error && !state) {
    return <PlayerStateShell title="Mesa" message={errorText(error, errorCode)} retry={isTerminalError(errorCode) ? null : () => void refresh(true)} />;
  }
  if (!state) {
    return <PlayerStateShell title="Mesa" message="Não foi possível carregar a Mesa." retry={() => void refresh()} />;
  }

  return <PlayerMesaScreen state={state} realtime={realtime} onRefresh={refresh} getRefreshVersion={getRefreshVersion} />;
}

/** Estrutura da tela real, sem conteúdo falso: o layout aparece antes do estado. */
function MesaLoadingSkeleton() {
  return (
    <main className="player-mesa-page mesa-loading-page" role="status" aria-label="Carregando Mesa">
      <header className="player-mesa-header mesa-skeleton-header">
        <div>
          <span className="mesa-skeleton-line mesa-skeleton-eyebrow" />
          <span className="mesa-skeleton-line mesa-skeleton-title" />
          <span className="mesa-skeleton-line mesa-skeleton-subtitle" />
        </div>
        <div className="mesa-skeleton-header-actions">
          <span className="mesa-skeleton-chip" />
          <span className="mesa-skeleton-chip mesa-skeleton-chip-wide" />
        </div>
      </header>

      <section className="player-mesa-turnstatus mesa-skeleton-turnstatus">
        <div className="player-mesa-turnstatus-main">
          <span className="mesa-skeleton-line mesa-skeleton-turn-title" />
          <span className="mesa-skeleton-line mesa-skeleton-turn-copy" />
        </div>
        <div className="mesa-skeleton-budget">
          <span /><span /><span />
        </div>
      </section>

      <div className="player-mesa-grid player-mesa-grid-table player-mesa-hud-grid mesa-skeleton-grid" aria-hidden="true">
        <aside className="player-mesa-column player-mesa-left-rail">
          <SkeletonPanel lines={5} />
          <SkeletonPanel lines={7} />
        </aside>

        <section className="player-mesa-column player-mesa-stage">
          <div className="player-mesa-tactical mesa-skeleton-tactical">
            <span className="mesa-skeleton-crosshair" />
            <span className="mesa-skeleton-map-line mesa-skeleton-map-line-a" />
            <span className="mesa-skeleton-map-line mesa-skeleton-map-line-b" />
          </div>
          <div className="player-mesa-stage-tools">
            <SkeletonPanel lines={3} />
            <SkeletonPanel lines={3} />
            <SkeletonPanel lines={3} />
          </div>
        </section>

        <aside className="player-mesa-column player-mesa-right-rail">
          <SkeletonPanel lines={9} />
          <SkeletonPanel lines={6} />
        </aside>
      </div>

      <div className="mesa-skeleton-log"><span /><span /><span /><span /></div>
    </main>
  );
}

function SkeletonPanel({ lines }: { lines: number }) {
  return (
    <section className="player-mesa-panel mesa-skeleton-panel">
      <span className="mesa-skeleton-line mesa-skeleton-panel-title" />
      <div className="mesa-skeleton-panel-lines">
        {Array.from({ length: lines }, (_, index) => <span key={index} />)}
      </div>
    </section>
  );
}

function PlayerStateShell({
  title,
  message,
  retry,
}: {
  title: string;
  message: string;
  retry: (() => void) | null;
}) {
  return (
    <main className="player-mesa-page">
      <section className="player-mesa-panel player-mesa-state">
        <span className="mesa-eyebrow">MESA</span>
        <h1>{title}</h1>
        <p className="mesa-hint">{message}</p>
        <div className="player-mesa-state-actions">
          {retry && (
            <button type="button" className="mesa-secondary" onClick={retry}>
              Tentar novamente
            </button>
          )}
          <Link className="mesa-ghost" href="/">
            Voltar para a ficha
          </Link>
        </div>
      </section>
    </main>
  );
}
