import type { MesaEvent } from "@/lib/mesa/types";

type Props = {
  event: MesaEvent;
};

/** Detalhamento visual do dado que o servidor registrou no evento. */
export default function RollAuditDetails({ event }: Props) {
  if (!event.roll) return null;

  return (
    <div className="mesa-roll-audit" aria-label="Detalhes da rolagem">
      <div className="mesa-roll-audit-heading">
        <span>{event.roll.label}</span>
        <strong>= {event.roll.total}</strong>
      </div>
      {event.roll.expression && <span className="mesa-roll-audit-expression">{event.roll.expression}</span>}
      <div className="mesa-roll-audit-dice">
        <span className="mesa-roll-audit-label">Dados</span>
        {event.roll.rolls.length > 0 ? (
          event.roll.rolls.map((value, index) => <b key={`${value}-${index}`}>[{value}]</b>)
        ) : (
          <span>sem dados individuais</span>
        )}
      </div>
    </div>
  );
}
