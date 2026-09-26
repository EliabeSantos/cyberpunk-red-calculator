"use client";

/**
 * Painel de combate da mesa — o que o Mestre e os jogadores veem durante o
 * turno. Não calcula nada sozinho: pede ao servidor e desenha o estado que ele
 * devolve. Os botões usam `resolveAction` (Combat Engine) só para DESABILITAR;
 * quem valida de verdade é a rota /api/mesa/[id]/combat/action.
 */

import Link from "next/link";
import { useState } from "react";

import { ACTIONS_PER_TURN, resolveAction, type CombatActionType } from "@/lib/combatEngine";
import {
  endCombat,
  endTurn,
  finishSession,
  performAction,
  removeCombatant,
  rollInitiative,
  updateCombatant,
  MesaApiError,
} from "@/lib/mesa/client";
import { denialMessage } from "@/lib/mesa/messages";
import type { MesaCombatant, MesaState } from "@/lib/mesa/types";

interface Props {
  sessionId: string;
  state: MesaState;
  isGM: boolean;
  sessionFinished: boolean;
  onNotice: (message: string, kind: "error" | "ok") => void;
  onChanged: () => Promise<void>;
}

/** Metros digitados: vazio/inválido/zero → 0 (botão de mover fica desabilitado). */
function metersFrom(raw: string): number {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export default function MesaCombatPanel({ sessionId, state, isGM, sessionFinished, onNotice, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [conditionDraft, setConditionDraft] = useState<{ id: string; value: string } | null>(null);
  // Rascunho de movimento identificado por combatente+rodada: um valor digitado
  // no turno A nunca vaza para o turno B (sem useEffect, só derivação no render).
  const [moveDraft, setMoveDraft] = useState<{ key: string; value: string } | null>(null);

  const combat = state.combat;
  const combatants = state.combatants;
  const activeCombatantId = combat?.activeCombatantId ?? null;
  const active = activeCombatantId
    ? combatants.find((combatant) => combatant.id === activeCombatantId) ?? null
    : null;
  const myTurn = Boolean(active && active.participantId && active.participantId === state.viewer.participantId);

  // Campo de movimento: o jogador digita os metros que quer andar neste turno.
  const moveKey = `${active?.id ?? ""}:${combat?.round ?? 0}`;
  const moveDraftValue = moveDraft?.key === moveKey ? moveDraft.value : "";
  const moveMeters = metersFrom(moveDraftValue);

  async function run(action: () => Promise<void>, successMessage?: string) {
    setBusy(true);
    try {
      await action();
      await onChanged();
      if (successMessage) onNotice(successMessage, "ok");
    } catch (caught) {
      onNotice(caught instanceof MesaApiError ? caught.message : "Falha na operação.", "error");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  function canPerform(actionType: CombatActionType, target: MesaCombatant, meters = 0): boolean {
    if (!combat || combat.status !== "active" || !combat.initiativeStarted) return false;
    const result = resolveAction({
      combatStatus: combat.status,
      initiativeStarted: combat.initiativeStarted,
      activeCombatantId: combat.activeCombatantId,
      actorRole: state.viewer.role ?? "player",
      actorOwnsCombatant: target.participantId === state.viewer.participantId,
      combatant: {
        id: target.id,
        isDead: target.isDead,
        actionsMax: target.actionsMax,
        actionsRemaining: target.actionsRemaining,
        movementMax: target.movementMax,
        movementRemaining: target.movementRemaining,
      },
      actionType,
      meters,
    });
    return result.ok;
  }

  function denialFor(actionType: CombatActionType, meters = 0): string {
    if (!combat || !active) return denialMessage("combat_not_started");
    const result = resolveAction({
      combatStatus: combat.status,
      initiativeStarted: combat.initiativeStarted,
      activeCombatantId: combat.activeCombatantId,
      actorRole: state.viewer.role ?? "player",
      actorOwnsCombatant: active.participantId === state.viewer.participantId,
      combatant: {
        id: active.id,
        isDead: active.isDead,
        actionsMax: active.actionsMax,
        actionsRemaining: active.actionsRemaining,
        movementMax: active.movementMax,
        movementRemaining: active.movementRemaining,
      },
      actionType,
      meters,
    });
    return result.ok ? "" : denialMessage(result.reason);
  }

  // --- Combate não iniciado -------------------------------------------------
  if (!combat || combat.status !== "active") {
    if (sessionFinished) return null;
    return (
      <section className="mesa-panel">
        <h2 className="mesa-panel-title">Combate</h2>
        {combat?.status === "finished" && <p className="mesa-hint">Combate anterior encerrado.</p>}
        {isGM ? (
          <div className="mesa-start-hint">
            <p className="mesa-hint">
              Monte o encontro (facção, nível e inimigos) na tela de <b>⚔️ Encontros</b> e use o botão{" "}
              <b>[ INICIAR COMBATE NA MESA ]</b> de lá — os inimigos criados entram aqui automaticamente.
            </p>
            <Link className="mesa-secondary" href="/gm/encounters">
              [ ABRIR ENCONTROS ]
            </Link>
          </div>
        ) : (
          <p className="mesa-hint">Aguardando o Mestre iniciar o combate.</p>
        )}
        <div className="mesa-actions">
          <button
            type="button"
            className="mesa-secondary"
            disabled={busy}
            onClick={() => void run(() => finishSession(sessionId), "Sessão encerrada.")}
          >
            Encerrar sessão
          </button>
        </div>
        <p className="mesa-note">
          Os combatentes entram pelos personagens vinculados da mesa e pelos inimigos do encontro.
        </p>
      </section>
    );
  }

  // --- Combate ativo --------------------------------------------------------
  // Últimos dados rolados nas fichas dos jogadores (o mais novo em cima):
  // é o atalho para ver a rolagem sem abrir o registro completo.
  const recentRolls = [...combat.eventLog].filter((event) => event.kind === "roll").slice(-4).reverse();

  return (
    <section className="mesa-panel mesa-combat">
      <header className="mesa-combat-header">
        <div>
          <span className="mesa-eyebrow">COMBATE</span>
          <strong>Rodada {combat.round}</strong>
        </div>
        <span className={`mesa-badge ${combat.initiativeStarted ? "is-live" : ""}`}>
          {combat.initiativeStarted ? "TURNO EM ANDAMENTO" : "INICIATIVA PENDENTE"}
        </span>
      </header>

      {!combat.initiativeStarted && isGM && (
        <div className="mesa-actions">
          <button
            type="button"
            className="mesa-primary"
            disabled={busy}
            onClick={() => run(() => rollInitiative(sessionId), "Iniciativa rolada.")}
          >
            [ ROLAR INICIATIVA ]
          </button>
        </div>
      )}

      {combat.initiativeStarted && active && (
        <div className="mesa-active-turn">
          <span className="mesa-eyebrow">ATIVO</span>
          <strong>{active.name}</strong>
          <div className="mesa-budget">
            <span title="Cyberpunk RED nesta mesa: 2 Actions por turno.">
              Ações: <b>{active.actionsRemaining}/{active.actionsMax || ACTIONS_PER_TURN}</b>
            </span>
            <span title="Orçamento de movimento = MOVE × 2 metros por turno (mover não custa Action).">
              Movimento: <b>{active.movementRemaining}/{active.movementMax} m</b>
            </span>
          </div>

          {!myTurn && !isGM && <p className="mesa-waiting">AGUARDANDO TURNO</p>}

          {(myTurn || isGM) && (
            <div className="mesa-actions">
              <ActionButton
                label="ATAQUE"
                enabled={canPerform("attack", active)}
                title={denialFor("attack")}
                busy={busy}
                onClick={() => run(() => performAction(sessionId, active.id, "attack"))}
              />
              <div className="mesa-move">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={Math.max(1, active.movementRemaining)}
                  value={moveDraftValue}
                  onChange={(event) => setMoveDraft({ key: moveKey, value: event.target.value })}
                  placeholder={`até ${active.movementRemaining}m`}
                  aria-label="Metros do movimento"
                  disabled={busy}
                />
                <ActionButton
                  label="MOVER"
                  enabled={canPerform("move", active, moveMeters)}
                  title={
                    moveMeters <= 0
                      ? "Digite quantos metros mover — não custa Action, sai do orçamento MOVE × 2."
                      : denialFor("move", moveMeters) || `Move ${moveMeters} m deste turno.`
                  }
                  busy={busy}
                  onClick={() => {
                    setMoveDraft(null);
                    void run(() => performAction(sessionId, active.id, "move", moveMeters));
                  }}
                />
              </div>
              <ActionButton
                label="ITEM"
                enabled={canPerform("item", active)}
                title={denialFor("item")}
                busy={busy}
                onClick={() => run(() => performAction(sessionId, active.id, "item"))}
              />
              <button
                type="button"
                className="mesa-ghost mesa-end-turn"
                disabled={busy}
                onClick={() => run(() => endTurn(sessionId), "Turno finalizado.")}
              >
                [ FINALIZAR TURNO ]
              </button>
            </div>
          )}
        </div>
      )}

      <ol className="mesa-combatants">
        {combatants.map((combatant) => {
          const isActive = combatant.id === combat.activeCombatantId;
          const owns = combatant.participantId === state.viewer.participantId;
          return (
            <li key={combatant.id} className={isActive ? "is-active" : combatant.isDead ? "is-dead" : ""}>
              <div className="mesa-combatant-main">
                <span className="mesa-initiative">{combatant.initiative ?? "—"}</span>
                <div className="mesa-combatant-info">
                  <strong>{combatant.name}</strong>
                  <small>
                    {combatant.kind === "enemy" ? "Inimigo" : owns ? "Você" : "Personagem"}
                    {isActive ? " · turno atual" : ""}
                  </small>
                </div>
                <span className="mesa-hp">
                  {combatant.hpCurrent}/{combatant.hpMax} HP
                </span>
              </div>

              <div className="mesa-combatant-conditions">
                {combatant.conditions.map((condition) => (
                  <button
                    key={condition}
                    type="button"
                    title={isGM ? "Remover condição" : condition}
                    disabled={!isGM || busy}
                    onClick={() =>
                      run(() =>
                        updateCombatant(sessionId, combatant.id, {
                          conditions: combatant.conditions.filter((entry) => entry !== condition),
                        }),
                      )
                    }
                  >
                    {condition}
                  </button>
                ))}
              </div>

              {isGM && (
                <div className="mesa-gm-tools">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(() => updateCombatant(sessionId, combatant.id, { hpCurrent: combatant.hpCurrent - 1 }))
                    }
                  >
                    −
                  </button>
                  <span>HP {combatant.hpCurrent}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(() => updateCombatant(sessionId, combatant.id, { hpCurrent: combatant.hpCurrent + 1 }))
                    }
                  >
                    +
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        updateCombatant(sessionId, combatant.id, {
                          initiative: (combatant.initiative ?? 0) + 1,
                        }),
                      )
                    }
                  >
                    ↻ Iniciativa
                  </button>
                  {combatant.kind === "enemy" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => removeCombatant(sessionId, combatant.id), "Inimigo removido.")}
                    >
                      Remover
                    </button>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const value = conditionDraft?.id === combatant.id ? conditionDraft.value.trim() : "";
                      if (!value) return;
                      setConditionDraft(null);
                      run(() =>
                        updateCombatant(sessionId, combatant.id, {
                          conditions: [...combatant.conditions, value],
                        }),
                      );
                    }}
                  >
                    <input
                      value={conditionDraft?.id === combatant.id ? conditionDraft.value : ""}
                      onChange={(event) => setConditionDraft({ id: combatant.id, value: event.target.value })}
                      placeholder="Condição"
                      maxLength={40}
                    />
                    <button type="submit" disabled={busy}>
                      +
                    </button>
                  </form>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {isGM && (
        <div className="mesa-actions mesa-gm-combat-actions">
          <button
            type="button"
            className="mesa-secondary"
            disabled={busy}
            onClick={() => run(() => endCombat(sessionId), "Combate encerrado.")}
          >
            [ ENCERRAR COMBATE ]
          </button>
          <button
            type="button"
            className="mesa-ghost"
            disabled={busy}
            onClick={() => run(() => finishSession(sessionId), "Sessão encerrada.")}
          >
            Encerrar sessão
          </button>
        </div>
      )}

      {recentRolls.length > 0 && (
        <div className="mesa-rolls">
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

      <details className="mesa-log">
        <summary>Registro do combate</summary>
        <ul>
          {[...combat.eventLog].reverse().map((event, index) => (
            <li key={`${event.at}-${index}`}>
              <time>{new Date(event.at).toLocaleTimeString()}</time> {event.text}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

interface ActionButtonProps {
  label: string;
  enabled: boolean;
  title: string;
  busy: boolean;
  onClick: () => void;
}

function ActionButton({ label, enabled, title, busy, onClick }: ActionButtonProps) {
  return (
    <button
      type="button"
      className="mesa-action"
      disabled={!enabled || busy}
      title={title || undefined}
      onClick={onClick}
    >
      [ {label} ]
    </button>
  );
}
