"use client";

/**
 * Painel de combate da mesa — o que o Mestre e os jogadores veem durante o
 * turno. Não calcula nada sozinho: pede ao servidor e desenha o estado que ele
 * devolve. Os botões usam `resolveAction` (Combat Engine) só para DESABILITAR;
 * quem valida de verdade é a rota /api/mesa/[id]/combat/action.
 */

import Link from "next/link";
import { useRef, useState } from "react";

import { ACTIONS_PER_TURN, type CombatActionType } from "@/lib/combatEngine";
import {
  applyPlayerDamage,
  applyPlayerHealing,
  endCombat,
  endTurn,
  finishSession,
  performAction,
  moveMesa,
  removeCombatant,
  rollInitiative,
  updateCombatant,
  MesaApiError,
} from "@/lib/mesa/client";
import { evaluateMesaAction } from "@/lib/mesa/actionGate";
import { denialMessage } from "@/lib/mesa/messages";
import { isHealingSupply } from "@/data/enemySupplies";
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
  const movePending = useRef(false);
  const [conditionDraft, setConditionDraft] = useState<{ id: string; value: string } | null>(null);
  // Rascunho de movimento identificado por combatente+rodada: um valor digitado
  // no turno A nunca vaza para o turno B (sem useEffect, só derivação no render).
  const [moveDraft, setMoveDraft] = useState<{ key: string; value: string } | null>(null);
  // F1.12.1/F1.12.2 — quantidade digitada pelo Mestre, por combatente, para o
  // DANO e para a CURA. O número NUNCA vira HP final: ele vira a INTENÇÃO que
  // os gateways server-side resolvem.
  const [amountDraft, setAmountDraft] = useState<{ id: string; value: string } | null>(null);

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
  const moveMeters = !isGM && (!Number.isSafeInteger(Number(moveDraftValue)) || moveDraftValue.trim() === "")
    ? 0 : metersFrom(moveDraftValue);

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
    // MESMA checagem do servidor (`resolveAction`), compartilhada com a tela
    // do Player — F1.12.3 evitou que cada tela reescrevesse este mapeamento.
    return evaluateMesaAction({ state, combatant: target, actionType, meters }).ok;
  }

  /**
   * Quantia digitada pelo Mestre para um combatente (F1.12.1/F1.12.2): vazio,
   * inválido ou não-positivo → 0, o que mantém os botões [ DANO ]/[ CURAR ]
   * desabilitados. O número NUNCA vira HP final — ele só vira a intenção de um
   * gateway server-side.
   */
  function draftAmount(combatant: MesaCombatant): number {
    const raw = amountDraft?.id === combatant.id ? amountDraft.value : "";
    const value = Math.floor(Number(raw));
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function draftValid(combatant: MesaCombatant): boolean {
    return draftAmount(combatant) > 0;
  }

  function denialFor(actionType: CombatActionType, meters = 0): string {
    if (!combat || !active) return denialMessage("combat_not_started");
    return evaluateMesaAction({ state, combatant: active, actionType, meters }).message;
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
            title="1d10 + REF de cada um — Iniciativa não tem regra de crítico"
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
              {isGM && <span className="mesa-waiting">ATAQUE PELA TELA DE ENCONTROS</span>}
              {!isGM && <span className="mesa-waiting">ATAQUE PELA FICHA</span>}
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
                    if (movePending.current || busy) return;
                    movePending.current = true;
                    void run(async () => {
                      if (isGM) await performAction(sessionId, active.id, "move", moveMeters);
                      else await moveMesa({ sessionId, actorCombatantId: active.id, distance: moveMeters });
                      setMoveDraft(null);
                    }).finally(() => { movePending.current = false; });
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
              {isGM && (
                <button
                  type="button"
                  className="mesa-ghost mesa-end-turn"
                  disabled={busy}
                  onClick={() => run(() => endTurn(sessionId), "Turno finalizado.")}
                >
                  [ FINALIZAR TURNO ]
                </button>
              )}
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
                <EnemySupplyChips combatant={combatant} />
              </div>

              {/* Conditions são deliberadamente somente leitura para Players.
                  Não há gateway de Player: hoje elas são rótulos sem modelo
                  mecânico próprio e são controladas pelo GM/servidor. */}
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
                  {combatant.kind === "character" ? (
                    // F1.12.1 + F1.12.2: HP de PERSONAGEM durante o combate é
                    // autoritativo no servidor — o Mestre só envia a QUANTIA e
                    // o gateway decide o resto.
                    //
                    //   [ DANO ]  → Player Damage Gateway (Damage Engine:
                    //               armadura, ablação, lesão)
                    //   [ CURAR ] → Player Healing Gateway (min(hp + amount, máx))
                    //
                    // O antigo "+" (alteração direta de HP) NÃO existe aqui.
                    // Medkit/First Aid/cura entre Players continuam fora do
                    // escopo — esta rota é só a intenção de cura do Mestre.
                    <div className="mesa-external-damage">
                      <span>HP {combatant.hpCurrent}</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={amountDraft?.id === combatant.id ? amountDraft.value : ""}
                        onChange={(event) => setAmountDraft({ id: combatant.id, value: event.target.value })}
                        placeholder="quant."
                        aria-label={`Quantia em ${combatant.name}`}
                        disabled={busy}
                      />
                      <button
                        type="button"
                        disabled={busy || !draftValid(combatant)}
                        title="Dano externo resolvido pelo servidor: armadura, ablação e lesões seguem o Damage Engine."
                        onClick={() => {
                          const amount = draftAmount(combatant);
                          if (amount <= 0) return;
                          void run(async () => {
                            await applyPlayerDamage(sessionId, {
                              targetCombatantId: combatant.id,
                              hpBefore: combatant.hpCurrent,
                              amount,
                              sourceContext: "ajuste do Mestre",
                            });
                            // Limpa só depois de aplicar: falhou, o rascunho fica.
                            setAmountDraft(null);
                          }, "Dano externo aplicado.");
                        }}
                      >
                        [ DANO ]
                      </button>
                      <button
                        type="button"
                        disabled={busy || !draftValid(combatant)}
                        title="Cura autoritativa: o servidor lê o HP atual da Mesa e aplica min(hp + quantia, hp máximo)."
                        onClick={() => {
                          const amount = draftAmount(combatant);
                          if (amount <= 0) return;
                          void run(async () => {
                            await applyPlayerHealing(sessionId, {
                              targetCombatantId: combatant.id,
                              amount,
                              sourceContext: "ajuste do Mestre",
                            });
                            // Limpa só depois de aplicar: falhou, o rascunho fica.
                            setAmountDraft(null);
                          }, "Cura aplicada.");
                        }}
                      >
                        [ CURAR ]
                      </button>
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}
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

/**
 * Mochila do INIMIGO espelhada da mesa: pente (balas/capacidade) e quantas
 * unidades de cura ainda restam.
 *
 * A mesa não calcula nada aqui — só lê `mesa_combatants.supplies`, que a tela
 * de Encontros reenvia a cada tiro, recarregamento ou cura. Sem mochila (ou
 * sem a migração da coluna) não desenha nada.
 */
function EnemySupplyChips({ combatant }: { combatant: MesaCombatant }) {
  if (combatant.kind !== "enemy") return null;
  const supplies = combatant.supplies;
  if (!supplies) return null;

  const healUnits = (supplies.inventory ?? [])
    .filter((entry) => isHealingSupply(entry.item))
    .reduce((total, entry) => total + entry.quantity, 0);

  const chips: string[] = [];
  if (typeof supplies.magazine === "number") {
    chips.push(`🔫 ${supplies.ammo ?? 0}/${supplies.magazine}`);
  }
  if (healUnits > 0) chips.push(`✚ ${healUnits}`);
  if (chips.length === 0) return null;

  return (
    <span className="mesa-supplies" title="Mochila do inimigo — munição do pente e itens de cura">
      {chips.join(" · ")}
    </span>
  );
}
