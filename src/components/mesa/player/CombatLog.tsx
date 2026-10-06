"use client";

/**
 * F1.12.3 — log da Mesa: o que aconteceu recentemente, na ordem do servidor.
 *
 * Além do `eventLog` completo, destaca as ÚLTIMAS rolagens de dados (as que os
 * jogadores mandaram pela ficha) — o mesmo recorte que o painel da sala já
 * mostrava, agora dentro da tela do Player.
 */

import { useState } from "react";

import type { MesaEvent } from "@/lib/mesa/types";

interface Props {
  events: MesaEvent[];
}

const RECENT_ROLLS = 4;
const VISIBLE_LOG = 14;

function formatTime(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString();
}

export default function CombatLog({ events }: Props) {
  const [expanded, setExpanded] = useState(false);

  const recentRolls = events.filter((event) => event.kind === "roll").slice(-RECENT_ROLLS).reverse();
  const reversed = [...events].reverse();
  const visible = expanded ? reversed : reversed.slice(0, VISIBLE_LOG);

  return (
    <section className="player-mesa-panel player-mesa-log">
      <div className="player-mesa-section-heading">
        <span className="mesa-eyebrow">REGISTRO</span>
        <strong>O que aconteceu</strong>
      </div>

      {recentRolls.length > 0 && (
        <div className="player-mesa-rolls">
          <span className="mesa-eyebrow">Dados na mesa</span>
          <ul>
            {recentRolls.map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <span aria-hidden="true">🎲</span> {event.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="mesa-hint">Nenhum evento ainda. O registro começa quando o combate abrir.</p>
      ) : (
        <ul className="player-mesa-events-list">
          {visible.map((event, index) => (
            <li key={`${event.at}-${index}`}>
              <time dateTime={event.at}>{formatTime(event.at)}</time>
              <span>{event.text}</span>
            </li>
          ))}
        </ul>
      )}

      {events.length > VISIBLE_LOG && (
        <button type="button" className="mesa-ghost player-mesa-log-toggle" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Recolher registro" : `Ver registro completo (${events.length})`}
        </button>
      )}
    </section>
  );
}
