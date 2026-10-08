"use client";

/**
 * F1.12.3 — faixa de TURNO + economia de ação.
 *
 * Responde, em um olhar, as perguntas 3 e 4 da tela: "é meu turno?" e "quantas
 * ações/movimento eu tenho?". Tudo derivado de `deriveTurnStatus` (puro) sobre
 * o estado do servidor — nada é calculado ou guardado aqui.
 *
 * O HP bar e os rótulos "FERIDO/ESTADO GRAVE" são SOMENTE visuais: Death Save,
 * Mortal Wound e cura continuam sendo decididos pelo servidor.
 */

import { ACTIONS_PER_TURN } from "@/lib/combatEngine";
import { deriveTurnStatus, hpCondition, hpPercent, type HpCondition } from "@/lib/mesa/playerScreen";
import type { MesaCombatant, MesaState } from "@/lib/mesa/types";

interface Props {
  state: MesaState;
  me: MesaCombatant | null;
  isGM?: boolean;
  isControllingEnemy?: boolean;
}

const HP_LABEL: Record<HpCondition, string> = {
  dead: "DERROTADO",
  critical: "ESTADO GRAVE",
  wounded: "FERIDO",
  ok: "ESTABILIZADO",
};

export default function TurnStatus({
  state,
  me,
  isGM = false,
  isControllingEnemy = false,
}: Props) {
  const baseStatus = deriveTurnStatus(state, me);
  const status = isGM && state.combat?.status === "active" && state.combat.initiativeStarted && !me
    ? {
        ...baseStatus,
        label: "NENHUM INIMIGO CONTROLADO",
        detail: "Selecione um inimigo na ordem de iniciativa para controlar suas ações.",
        myTurn: false,
      }
    : isControllingEnemy && baseStatus.myTurn && me
      ? {
          ...baseStatus,
          label: "TURNO DO INIMIGO",
          detail: `Controlando ${me.name}. ${baseStatus.detail}`,
        }
      : baseStatus;
  const combat = state.combat;
  const condition = hpCondition(me);

  return (
    <section className={`player-mesa-turnstatus tone-${status.tone}`} aria-live="polite">
      <div className="player-mesa-turnstatus-main">
        <span className="mesa-eyebrow">
          {isControllingEnemy && status.myTurn ? "CONTROLE GM" : status.myTurn ? "SEU TURNO" : "STATUS"}
        </span>
        <strong>{status.label}</strong>
        <p>{status.detail}</p>
      </div>

      <div className="player-mesa-budget">
        <span>
          RODADA
          <b>{combat?.status === "active" ? combat.round : "—"}</b>
        </span>
        <span title="Cyberpunk RED nesta mesa: 2 Actions por turno.">
          AÇÕES
          <b>
            {me ? (
              <span className="player-mesa-resource-value">
                <span className="player-mesa-dots" aria-label={`${me.actionsRemaining} ações restantes`}>
                  {Array.from({ length: me.actionsMax || ACTIONS_PER_TURN }, (_, index) => (
                    <i key={index} className={index < me.actionsRemaining ? "is-full" : ""} />
                  ))}
                </span>
                {me.actionsRemaining}/{me.actionsMax || ACTIONS_PER_TURN}
              </span>
            ) : "—"}
          </b>
        </span>
        <span title="Orçamento de movimento = MOVE × 2 metros por turno (mover não custa Action).">
          MOVIMENTO
          <b>
            {me ? (
              <span className="player-mesa-resource-value">
                <span className="player-mesa-dots player-mesa-dots-move" aria-label={`${me.movementRemaining} metros restantes`}>
                  {Array.from({ length: Math.min(me.movementMax, 8), }, (_, index) => (
                    <i key={index} className={index < Math.min(me.movementRemaining, 8) ? "is-full" : ""} />
                  ))}
                </span>
                {me.movementRemaining}/{me.movementMax} m
              </span>
            ) : "—"}
          </b>
        </span>
        <span className="player-mesa-hp-chip">
          HP
          <b>{me ? `${me.hpCurrent}/${me.hpMax}` : "—"}</b>
          <span className="player-mesa-hp-bar">
            <i className={`hp-${condition}`} style={{ width: `${hpPercent(me)}%` }} />
          </span>
        </span>
        {me && <span className="player-mesa-condition-chip">{HP_LABEL[condition]}</span>}
      </div>
    </section>
  );
}
