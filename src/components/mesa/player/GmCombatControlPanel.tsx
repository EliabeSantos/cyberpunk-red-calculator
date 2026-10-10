"use client";

import { useState } from "react";

import { getSupplyHealAmount } from "@/data/enemySupplies";
import { resolveSupplyItemId } from "@/data/supplyItems";
import {
  attackMesa,
  formatAttackGatewayError,
  applyMesaHealingItem,
  consumeMesaItem,
  endTurn,
  moveMesa,
  reloadMesa,
  rollInitiative,
} from "@/lib/mesa/client";
import { evaluateMesaAction } from "@/lib/mesa/actionGate";
import { tacticalCoverObstacleId } from "@/lib/mesa/tacticalMap";
import { getTacticalCoverProfile } from "@/lib/mesa/tacticalCoverCatalog";
import { rangeBandLabel } from "@/lib/combat/weaponRange";
import type { CombatWeapon } from "@/lib/combat/contract";
import type { AvailableAttack } from "@/types/attack";
import type { MesaState } from "@/lib/mesa/types";
import type { RunAction } from "./types";

interface Props {
  state: MesaState;
  busy: boolean;
  run: RunAction;
  metadata: Record<string, { weapons: CombatWeapon[]; attacks: AvailableAttack[] }>;
  sessionFinished: boolean;
  controlledCombatantId: string | null;
  selectedTargetId: string;
  selectedWeaponId: string;
  onSelectWeapon: (weaponId: string) => void;
  selectedAttackId: string;
  onSelectAttack: (attackId: string) => void;
  controlMode: "enemy" | "map";
  onControlModeChange: (mode: "enemy" | "map") => void;
  onAttackAnimation?: (attackerId: string, targetId: string, kind: "ranged" | "melee", hit: boolean, damage: number | null) => void;
}

type AttackMode = "normal" | "aimed";
type AimedTarget = "head" | "leg" | "held_item";

export default function GmCombatControlPanel({
  state,
  busy,
  run,
  metadata,
  sessionFinished,
  controlledCombatantId,
  selectedTargetId,
  selectedWeaponId,
  onSelectWeapon,
  selectedAttackId,
  onSelectAttack,
  controlMode,
  onControlModeChange,
  onAttackAnimation,
}: Props) {
  const [moveDraft, setMoveDraft] = useState("");
  const [attackMode, setAttackMode] = useState<AttackMode>("normal");
  const [aimedTarget, setAimedTarget] = useState<AimedTarget>("head");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [attackError, setAttackError] = useState<string | null>(null);

  const players = state.combatants.filter((combatant) => combatant.kind === "character" && !combatant.isDead);
  const selected = state.combatants.find((combatant) => combatant.id === controlledCombatantId) ?? null;
  const control = selected ? metadata[selected.id] ?? { weapons: [], attacks: [] } : { weapons: [], attacks: [] };
  const weapons = control.weapons;
  const attacks = control.attacks;
  const selectedAttack = attacks.find((attack) => attack.id === selectedAttackId) ?? attacks[0] ?? null;
  const selectedWeapon = selectedAttack?.context.weaponId
    ? weapons.find((weapon) => weapon.id === selectedAttack.context.weaponId) ?? null
    : null;
  const target = players.find((combatant) => combatant.id === selectedTargetId) ?? players[0] ?? null;
  const coverObstacleId = tacticalCoverObstacleId(selectedTargetId);
  const selectedCover = coverObstacleId
    ? [...(state.session.tacticalMap?.geometry?.walls ?? []), ...(state.session.tacticalMap?.geometry?.doors ?? [])].find((entry) => entry.id === coverObstacleId && entry.destroyed !== true && !(entry.type === "door" && entry.state === "open")) ?? null
    : null;
  const selectedCoverProfile = selectedCover ? getTacticalCoverProfile(selectedCover.coverMaterial, selectedCover.coverThickness) : null;
  const moveMeters = Number.isSafeInteger(Number(moveDraft)) ? Number(moveDraft) : 0;
  const isActive = Boolean(selected && selected.id === state.combat?.activeCombatantId);
  const actionGate = selected
    ? evaluateMesaAction({ state, combatant: selected, actionType: "attack" })
    : { ok: false, message: "Selecione um inimigo." };
  const moveGate = selected
    ? evaluateMesaAction({ state, combatant: selected, actionType: "move", meters: moveMeters })
    : { ok: false, message: "Selecione um inimigo." };
  const reloadGate = selected
    ? evaluateMesaAction({ state, combatant: selected, actionType: "reload" })
    : { ok: false, message: "Selecione um inimigo." };

  const inventory = selected?.supplies?.inventory ?? [];
  const itemGate = selected
    ? evaluateMesaAction({ state, combatant: selected, actionType: "item" })
    : { ok: false, message: "Selecione um inimigo." };

  async function doAttack() {
    if (!selected || (!target && !coverObstacleId) || !selectedAttack || busy) return;
    setAttackError(null);
    setFeedback(null);
    await run(
      async () => {
        const result = await attackMesa({
          sessionId: state.session.id,
          actorId: selected.id,
          targetId: coverObstacleId ? "" : target?.id ?? "",
          ...(coverObstacleId ? { targetType: "cover" as const, obstacleId: coverObstacleId } : {}),
           ...(selectedAttack.context.weaponId ? { weaponId: selectedAttack.context.weaponId } : {}),
           skillId: selectedAttack.context.skillId ?? selectedWeapon?.skill,
           attackType: selectedWeapon?.attackType ?? selectedAttack.context.type,
          attackMode,
          ...(attackMode === "aimed" ? { aimedTarget } : {}),
        });
         const range = result.weaponRange?.status === "valid" ? ` Alcance: ${rangeBandLabel(result.weaponRange.band)} · DV ${result.weaponRange.dv} · ${result.weaponRange.distanceMeters}m.` : "";
          setFeedback(`${selected.name} atacou ${coverObstacleId ? "a Cover" : target?.name ?? "o alvo"}.${range}${result.coverDamage ? ` Cover: ${result.coverDamage.hpBefore}→${result.coverDamage.hpAfter} HP${result.coverDamage.destroyed ? " · DESTRUÍDA" : ""}` : result.tacticalCover ? ` Cover: ${result.tacticalCover.status.toUpperCase()} (${result.tacticalCover.blockedSamples}/${result.tacticalCover.totalSamples})${result.tacticalCover.status !== "clear" ? " · sem modificador mecânico definido" : ""}` : ""}`);
          if (!coverObstacleId && target) {
            const melee = ["melee", "martial_arts", "brawling", "unarmed"].includes(selectedWeapon?.attackType ?? selectedAttack.context.type);
            onAttackAnimation?.(selected.id, target.id, melee ? "melee" : "ranged", result.attackResult.hit, result.damageResult?.damageAfterArmor ?? null);
          }
      },
      { onError: (message, code) => setAttackError(formatAttackGatewayError(message, code)) },
    );
  }

  async function doMove() {
    if (!selected || !moveGate.ok || busy) return;
    await run(
      async () => {
        await moveMesa({ sessionId: state.session.id, actorCombatantId: selected.id, distance: moveMeters });
        setMoveDraft("");
        setFeedback(`${selected.name} moveu ${moveMeters}m.`);
      },
      { onError: setFeedback },
    );
  }

  async function doReload() {
    if (!selected || !selectedWeapon?.id || busy) return;
    const weaponId = selectedWeapon.id;
    await run(
      async () => {
        await reloadMesa({ sessionId: state.session.id, actorCombatantId: selected.id, weaponId });
        setFeedback(`${selected.name} recarregou ${selectedWeapon.name}.`);
      },
      { onError: setFeedback },
    );
  }

  async function doHealItem(itemId: string) {
    if (!selected || busy) return;
    await run(
      async () => {
        const result = await applyMesaHealingItem({
          sessionId: state.session.id,
          actorCombatantId: selected.id,
          itemId,
        });
        setFeedback(`${result.itemName}: +${result.restored} HP · resta ${result.quantityAfter}.`);
      },
      { onError: setFeedback },
    );
  }

  async function doConsumeItem(itemId: string) {
    if (!selected || busy) return;
    await run(
      async () => {
        const result = await consumeMesaItem({
          sessionId: state.session.id,
          actorCombatantId: selected.id,
          itemId,
          amount: 1,
        });
        setFeedback(`${result.itemName}: consumido · resta ${result.quantityAfter}.`);
      },
      { onError: setFeedback },
    );
  }

  return (
    <section className="player-mesa-panel player-mesa-gm-control" aria-label="GM control">
      <div className="player-mesa-section-heading">
        <span className="mesa-eyebrow">GM CONTROL</span>
        <strong>{controlMode === "map" ? "Mapa tático" : selected ? selected.name : "Selecione um inimigo"}</strong>
      </div>

      <div className="gm-control-switch" role="tablist" aria-label="Modo de controle do GM">
        <button type="button" role="tab" aria-selected={controlMode === "enemy"} className={controlMode === "enemy" ? "is-active" : ""} onClick={() => onControlModeChange("enemy")}>INIMIGOS</button>
        <button type="button" role="tab" aria-selected={controlMode === "map"} className={controlMode === "map" ? "is-active" : ""} onClick={() => onControlModeChange("map")}>MAPA / HACK</button>
      </div>

      {controlMode === "map" ? <div className="gm-map-mode-hint"><span className="mesa-eyebrow">MAPA TÁTICO</span><strong>Ferramentas do mapa</strong><p>As opções de edição ficam aqui para liberar espaço no campo central.</p><div id={`gm-map-tools-slot-${state.session.id}`} className="gm-map-tools-slot" /><button type="button" className="mesa-secondary" onClick={() => onControlModeChange("enemy")}>Voltar ao controle de inimigos</button></div> : <>

      <div className="player-mesa-gm-turn-actions">
        {!state.combat?.initiativeStarted && state.combat?.status === "active" && (
          <button
            type="button"
            className="mesa-primary"
            disabled={busy || sessionFinished}
            onClick={() => void run(() => rollInitiative(state.session.id), { success: "Iniciativa rolada." })}
          >
            [ ROLAR INICIATIVA ]
          </button>
        )}
        {state.combat?.initiativeStarted && state.combat.activeCombatantId && (
          <button
            type="button"
            className="mesa-ghost mesa-end-turn"
            disabled={busy || sessionFinished}
            onClick={() => void run(() => endTurn(state.session.id), { success: "Turno passado." })}
          >
            [ PASSAR TURNO ]
          </button>
        )}
      </div>

      {selected && (
        <>
          <div className="player-mesa-gm-turn-state">
            <span className="mesa-eyebrow">{isActive ? "YOUR CONTROL" : "GM CONTROLLED"}</span>
            <strong>{isActive ? "Turno deste inimigo" : "Aguardando o turno"}</strong>
            <span>{state.combat?.activeCombatantId ? `Ativo: ${state.combatants.find((entry) => entry.id === state.combat?.activeCombatantId)?.name ?? "—"}` : "Iniciativa pendente"}</span>
          </div>

          <div className="player-mesa-gm-vitals">
            <span>HP <b>{selected.hpCurrent}/{selected.hpMax}</b></span>
            <span>ARMOR <b>{selected.armor ? `C ${selected.armor.body} · H ${selected.armor.head}` : "—"}</b></span>
            <span>ACTIONS <b>{selected.actionsRemaining}/{selected.actionsMax}</b></span>
            <span>MOVE <b>{selected.movementRemaining}/{selected.movementMax}m</b></span>
          </div>

          <section className="player-mesa-gm-resources" aria-label="Enemy equipment and inventory">
            <div className="player-mesa-gm-resource-heading">
              <span className="mesa-eyebrow">WEAPONS</span>
              <small>munição server-side</small>
            </div>
            {weapons.length === 0 ? (
              <p className="mesa-hint">Nenhuma arma disponível.</p>
            ) : (
              <div className="player-mesa-gm-weapon-list">
                {weapons.map((weapon) => {
                  const hasMagazine = typeof weapon.magazine === "number" && weapon.magazine > 0;
                  const ammo = weapon.id ? selected.ammoByWeapon?.[weapon.id] : undefined;
                  const isSelected = weapon.id === selectedWeapon?.id;
                  const canReload = reloadGate.ok && hasMagazine && typeof ammo === "number" && ammo < (weapon.magazine ?? 0);
                  return (
                    <article className={`player-mesa-gm-weapon ${isSelected ? "is-selected" : ""}`} key={weapon.id ?? weapon.name}>
                      <button
                        type="button"
                        className="player-mesa-gm-weapon-select"
                        disabled={busy}
                        aria-pressed={isSelected}
                        onClick={() => {
                          onSelectWeapon(weapon.id ?? "");
                          const attack = attacks.find((candidate) => candidate.context.weaponId === weapon.id);
                          if (attack) onSelectAttack(attack.id);
                        }}
                      >
                        <strong>{weapon.name}</strong>
                        <span>{hasMagazine ? `${typeof ammo === "number" ? ammo : "—"}/${weapon.magazine}` : "Sem magazine"}</span>
                      </button>
                      <div className="player-mesa-gm-weapon-meta">
                        <span>{weapon.damage}</span>
                        {typeof weapon.rateOfFire === "number" && <span>ROF {weapon.rateOfFire}</span>}
                        {weapon.skill && <span>{weapon.skill}</span>}
                      </div>
                      {hasMagazine && (
                        <button
                          type="button"
                          className="mesa-secondary"
                          disabled={busy || !isSelected || !canReload}
                          title={reloadGate.message || undefined}
                          onClick={() => void doReload()}
                        >
                          Recarregar
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            <div className="player-mesa-gm-resource-heading player-mesa-gm-inventory-heading">
              <span className="mesa-eyebrow">INVENTORY</span>
              <small>supplies.inventory</small>
            </div>
            {inventory.length === 0 ? (
              <p className="mesa-hint">Mochila vazia neste combate.</p>
            ) : (
              <ul className="player-mesa-gm-inventory-list">
                {inventory.map((entry) => {
                  const itemId = resolveSupplyItemId(entry);
                  const healable = getSupplyHealAmount(entry.item) !== null;
                  const usable = entry.quantity > 0 && itemGate.ok && (!healable || selected.hpCurrent < selected.hpMax);
                  return (
                    <li key={itemId || entry.item}>
                      <span>{entry.item}</span>
                      <b>×{entry.quantity}</b>
                      {itemId && (
                        <button
                          type="button"
                          className="mesa-secondary"
                          disabled={busy || !usable}
                          title={!itemGate.ok ? itemGate.message : selected.hpCurrent >= selected.hpMax && healable ? "HP já está no máximo." : undefined}
                          onClick={() => void (healable ? doHealItem(itemId) : doConsumeItem(itemId))}
                        >
                          {healable ? "Usar" : "Consumir"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
       )}
    </section>

            {selectedCover && <div className="player-mesa-target-readout" aria-label="Alvo Cover">
             <strong>ALVO: COVER</strong>
             <span>DV para atacar: {selectedCover.coverDV ?? "não definido"}</span>
             <span>HP: {selectedCover.coverHP ?? "não definido"}{selectedCoverProfile ? ` / ${selectedCoverProfile.hp}` : ""}</span>
           </div>}

           <label className="player-mesa-gm-target">
             Ataque
             <select value={selectedAttack?.id ?? ""} disabled={busy || attacks.length === 0} onChange={(event) => {
               const attack = attacks.find((candidate) => candidate.id === event.target.value);
               onSelectAttack(event.target.value);
               if (attack?.context.weaponId) onSelectWeapon(attack.context.weaponId);
             }}>
               {attacks.length === 0 ? <option value="">Nenhum ataque disponível</option> : attacks.map((attack) => <option key={attack.id} value={attack.id}>{attack.label}</option>)}
             </select>
           </label>

           <label className="player-mesa-gm-target">
            Ataque
            <select value={attackMode} disabled={busy} onChange={(event) => setAttackMode(event.target.value as AttackMode)}>
              <option value="normal">Normal</option>
              <option value="aimed">Aimed</option>
            </select>
          </label>
          {attackMode === "aimed" && (
            <label className="player-mesa-gm-target">
              Local
              <select value={aimedTarget} disabled={busy} onChange={(event) => setAimedTarget(event.target.value as AimedTarget)}>
                <option value="head">Head</option>
                <option value="leg">Leg</option>
                <option value="held_item">Held Item</option>
              </select>
            </label>
          )}

          <div className="player-mesa-gm-actions">
             <button type="button" className="mesa-primary" disabled={busy || sessionFinished || !actionGate.ok || (!target && !coverObstacleId) || !selectedAttack} title={actionGate.message || undefined} onClick={() => void doAttack()}>
              {busy ? "PROCESSANDO..." : attackMode === "aimed" ? "[ AIMED ATTACK ]" : "[ ATTACK ]"}
            </button>
            <div className="player-mesa-gm-move">
              <input type="number" min={1} value={moveDraft} onChange={(event) => setMoveDraft(event.target.value)} placeholder="metros" disabled={busy} aria-label="Metros do inimigo" />
              <button type="button" className="mesa-action" disabled={busy || sessionFinished || !moveGate.ok} title={moveGate.message || undefined} onClick={() => void doMove()}>[ MOVE ]</button>
            </div>
            <button type="button" className="mesa-action" disabled={busy || sessionFinished || !isActive || !selectedWeapon?.magazine} onClick={() => void doReload()}>[ RELOAD ]</button>
          </div>
        </>
      )}

      {attackError && <p className="player-mesa-error" role="alert">{attackError}</p>}
      {feedback && <p className="player-mesa-feedback" role="status">{feedback}</p>}
       {!selected && <p className="mesa-hint">Nenhum inimigo disponível para controle.</p>}
       </>}
    </section>
  );
}
