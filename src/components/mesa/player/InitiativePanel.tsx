"use client";

/**
 * F1.12.3 — elenco da Mesa na ORDEM de iniciativa (iniciativa/turnos +
 * seleção de alvo no mesmo lugar, para a tela não virar uma grade de caixas).
 *
 * A ordenação é a `sortByInitiative` do Combat Engine — a MESMA que o servidor
 * usa para avançar turnos. Clicar num inimigo vivo só define o alvo do
 * ataque aqui; quem decide se o ataque acerta é o servidor.
 */

import { rosterInInitiativeOrder } from "@/lib/mesa/playerScreen";
import type { MesaCombatant, MesaState } from "@/lib/mesa/types";
import type { CombatWeapon } from "@/lib/combat/contract";
import CombatantFigure from "@/components/mesa/CombatantFigure";
import type { TacticalAttackAnimation } from "./TacticalView";

interface Props {
  state: MesaState;
  me: MesaCombatant | null;
  /** Alvo atualmente escolhido para o ataque (combatente inimigo). */
  selectedTargetId: string;
  onSelectTarget: (combatantId: string) => void;
  controlledCombatantId?: string | null;
  onSelectControl?: (combatantId: string) => void;
  figureCombatantId?: string | null;
  figureWeapon?: CombatWeapon | null;
  attackAnimation?: TacticalAttackAnimation | null;
}

export default function InitiativePanel({
  state,
  me,
  selectedTargetId,
  onSelectTarget,
  controlledCombatantId,
  onSelectControl,
  figureCombatantId,
  figureWeapon,
  attackAnimation,
}: Props) {
  const roster = rosterInInitiativeOrder(state);
  const activeCombatantId = state.combat?.activeCombatantId ?? null;
  const combatActive = state.combat?.status === "active";

  return (
    <section className="player-mesa-panel player-mesa-initiative-panel">
      <div className="player-mesa-section-heading">
        <span className="mesa-eyebrow">INICIATIVA</span>
        <strong>Ordem de turno</strong>
      </div>

      <ol className="player-mesa-initiative">
        {roster.map((combatant) => {
          const isActive = combatant.id === activeCombatantId;
          const isYou = Boolean(me && combatant.id === me.id);
          const selectable = combatActive && combatant.kind === "enemy" && !combatant.isDead;
            const selected = combatant.id === selectedTargetId;
           const visibleWeapon = combatant.id === figureCombatantId ? figureWeapon : null;

          const content = (
              <>
               <span className="player-mesa-figure-cell">
                  <CombatantFigure combatant={combatant} weapon={visibleWeapon} visualWeaponKind={combatant.visualWeaponKind} animation={attackAnimation?.attackerId === combatant.id ? attackAnimation.kind : undefined} active={isActive} compact />
               </span>
               <span className="player-mesa-initiative-num" aria-label="Iniciativa">
                {combatant.initiative ?? "—"}
              </span>
              <span className="player-mesa-initiative-name">
                <b>{combatant.name}</b>
                <small>
                  {combatant.kind === "enemy" ? "Inimigo" : isYou ? "Você" : "Aliado"}
                  {isActive ? " · turno atual" : ""}
                </small>
              </span>
              <span className="player-mesa-initiative-hp">
                {combatant.hpCurrent}/{combatant.hpMax}
                <small>{combatant.isDead ? "DERROTADO" : `${combatant.actionsRemaining} ações`}</small>
              </span>
            </>
          );

          return (
            <li
              key={combatant.id}
              className={[
                isActive ? "is-active" : "",
                combatant.isDead ? "is-dead" : "",
                isYou ? "is-you" : "",
                selected ? "is-selected" : "",
                controlledCombatantId === combatant.id ? "is-controlled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {selectable ? (
                <button
                  type="button"
                  onClick={() => {
                    onSelectTarget(combatant.id);
                    onSelectControl?.(combatant.id);
                  }}
                  aria-pressed={selected}
                  title={onSelectControl ? `Controlar ${combatant.name}` : selected ? "Alvo selecionado" : `Atacar ${combatant.name}`}
                >
                  {content}
                </button>
              ) : (
                <div>{content}</div>
              )}

              {combatant.conditions.length > 0 && (
                <p className="player-mesa-initiative-conditions">
                  {combatant.conditions.map((condition) => (
                    <span key={condition}>{condition}</span>
                  ))}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <p className="mesa-hint">
        Clique num inimigo vivo para escolher o alvo. Iniciativa e HP vêm sempre do servidor.
      </p>
    </section>
  );
}
