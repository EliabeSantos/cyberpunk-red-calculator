"use client";

/**
 * F1.12.3 — log da Mesa: o que aconteceu recentemente, na ordem do servidor.
 *
 * Além do `eventLog` completo, destaca as ÚLTIMAS rolagens de dados (as que os
 * jogadores mandaram pela ficha) — o mesmo recorte que o painel da sala já
 * mostrava, agora dentro da tela do Player.
 */

import { useMemo, useState } from "react";

import type { MesaEvent } from "@/lib/mesa/types";
import RollAuditDetails from "@/components/mesa/RollAuditDetails";

interface Props {
  events: MesaEvent[];
}

const RECENT_ROLLS = 4;
const VISIBLE_LOG = 14;

function formatTime(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString();
}

function netEventLabel(text: string): string | null {
  const value = text.toLowerCase();
  if (value.includes("quickhack")) return "QUICKHACK";
  if (value.includes("pathfinder") || value.includes("backdoor") || value.includes("control") || value.includes("zap") || value.includes("slide")) return "NET ACTION";
  if (value.includes("black ice") || value.includes("ice")) return "BLACK ICE";
  if (value.includes("jack in") || value.includes("jack out")) return "CONNECTION";
  if (value.includes("floor") || value.includes("node") || value.includes("discov")) return "NET";
  return null;
}

export default function CombatLog({ events }: Props) {
  const [expanded, setExpanded] = useState(false);

  const recentRolls = useMemo(
    () => events.filter((event) => event.kind === "roll").slice(-RECENT_ROLLS).reverse(),
    [events],
  );
  const visible = useMemo(() => {
    const reversed = [...events].reverse();
    return expanded ? reversed : reversed.slice(0, VISIBLE_LOG);
  }, [events, expanded]);
  const visibleWithLabels = useMemo(
    () => visible.map((event) => ({ event, label: netEventLabel(event.text) })),
    [visible],
  );

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
               <RollAuditDetails event={event} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="mesa-hint">Nenhum evento ainda. O registro começa quando o combate abrir.</p>
      ) : (
        <ul className="player-mesa-events-list">
            {visibleWithLabels.map(({ event, label }, index) => (
             <li className={label ? "is-net-event" : ""} key={`${event.at}-${index}`}>
               <time dateTime={event.at}>{formatTime(event.at)}</time>
              <span>
                 {label && <b className="mesa-event-kind">{label}</b>}
                {event.text}
               <RollAuditDetails event={event} />
             </span>
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
