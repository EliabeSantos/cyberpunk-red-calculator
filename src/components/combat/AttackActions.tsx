"use client";

import { useState } from "react";
import { getAvailableAttacks, isRangedAttackType, rollAttack } from "@/lib/attacks";
import { attackMesa, MesaApiError } from "@/lib/mesa/client";
import type { AttackResult, DamageResult } from "@/lib/combat/contract";
import type { DiceResult } from "@/lib/dice";
import type { AttackRollResult, AttackMode } from "@/types/attack";
import type { Character } from "@/types/character";

export interface PlayerAttackTarget {
  id: string;
  name: string;
  kind: "character" | "enemy";
  isDead: boolean;
}

export interface PlayerAttackSetup {
  sessionId: string;
  actorId: string;
  targets: PlayerAttackTarget[];
  onRefresh: () => Promise<void>;
}

export interface PlayerAttackContext extends PlayerAttackSetup {
  onResult: (result: AttackResult) => void;
  onWeaponDamage: (roll: DiceResult) => void;
  onDamageResult: (result: DamageResult) => void;
  onDamageError: (message: string) => void;
  onError: (message: string) => void;
}

type Props = {
  character: Character;
  onUpdate: (character: Character) => void;
  onResult: (result: AttackRollResult) => void;
  weaponAttackModes?: Record<string, AttackMode>;
  onAttackModeChange?: (weaponId: string, mode: AttackMode) => void;
  mesaAttack?: PlayerAttackContext;
  mesaAttackUnavailable?: boolean;
};

const attackModeLabels: Record<AttackMode, { label: string; cost: string }> = {
  normal: { label: "Normal", cost: "1" },
  aimed: { label: "Aimed", cost: "1" },
  autofire: { label: "Autofire", cost: "10" },
  suppressive: { label: "Suppressive", cost: "10" },
};

export default function AttackActions(props: Props) {
  // Os testes e consumidores do modo local chamam este componente como uma
  // função; manter o caminho legado sem Hooks preserva esse contrato. O ramo
  // online é um componente React separado, onde o estado de alvo/busy é seguro.
  if (props.mesaAttackUnavailable) return <p className="sheet-empty">Combate da Mesa indisponível: ataque não executado.</p>;
  return props.mesaAttack ? <PlayerAttackActions {...props} mesaAttack={props.mesaAttack} /> : LegacyAttackActions(props);
}

function LegacyAttackActions({ character, onUpdate, onResult, weaponAttackModes, onAttackModeChange }: Props) {
  const attacks = getAvailableAttacks(character);

  function attack(attackId: string, mode?: AttackMode) {
    const availableAttack = attacks.find((item) => item.id === attackId);
    if (!availableAttack) return;
    const context = mode ? { ...availableAttack.context, attackMode: mode } : availableAttack.context;
    const resolution = rollAttack(character, context);
    if ("error" in resolution) return;
    onUpdate(resolution.character);
    onResult(resolution.result);
  }

  if (!attacks.length) return <p className="sheet-empty">Equipe uma arma ou aumente uma perícia de ataque para rolar.</p>;

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      {attacks.map((availableAttack) => {
        const weaponId = availableAttack.context.weaponId;
        const weapon = weaponId ? character.weapons.find((w) => w.id === weaponId) : null;
        const isRanged = Boolean(weaponId) && isRangedAttackType(weapon?.attackType ?? availableAttack.context.type, weapon?.skill ?? availableAttack.context.skillId);
        const currentMode = weaponId && weaponAttackModes ? weaponAttackModes[weaponId] ?? "normal" : "normal";
        const isOut = weapon?.ammo !== undefined && weapon.ammo <= 0;
        return (
          <div key={availableAttack.id} style={{ border: "1px solid #3a4a3d", borderRadius: "4px", background: "#0f1512", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0.6rem", borderBottom: "1px solid #2a352c", background: "#141c18" }}>
              <strong style={{ color: "var(--foreground)", fontSize: "0.8rem" }}>{availableAttack.label}</strong>
              {weapon && <small style={{ color: "var(--muted)", fontSize: "0.65rem" }}>{weapon.damage}{weapon.rateOfFire ? ` · ROF ${weapon.rateOfFire}` : ""}</small>}
              {!weapon && <small style={{ color: "var(--muted)", fontSize: "0.65rem" }}>{availableAttack.detail}</small>}
            </div>
            {isRanged && weaponId && (
              <div style={{ display: "flex", gap: "0.2rem", padding: "0.35rem 0.6rem", borderBottom: "1px solid #2a352c", background: "#111915" }}>
                {(["normal", "aimed", "autofire", "suppressive"] as AttackMode[]).map((mode) => {
                  const info = attackModeLabels[mode];
                  return <button key={mode} type="button" onClick={() => onAttackModeChange?.(weaponId, mode)} style={{ flex: 1, border: `1px solid ${currentMode === mode ? "var(--accent)" : "#3a4a3d"}`, background: currentMode === mode ? "var(--accent)" : "transparent", color: currentMode === mode ? "#111700" : "var(--muted)", padding: "0.2rem", fontSize: "0.58rem" }}>{info.label}<br /><span>{info.cost} ammo</span></button>;
                })}
              </div>
            )}
            <div style={{ padding: "0.35rem 0.6rem" }}>
              <button type="button" onClick={() => attack(availableAttack.id, isRanged ? currentMode : undefined)} disabled={isOut} style={{ width: "100%", color: isOut ? "#666" : "var(--accent)", padding: "0.35rem", fontSize: "0.7rem" }}>
                {isOut ? "🔫 Sem munição" : "🎲 Rolar ataque"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PlayerAttackActions({ character, onUpdate, onResult, weaponAttackModes, onAttackModeChange, mesaAttack }: Props & { mesaAttack: PlayerAttackContext }) {
  const attacks = getAvailableAttacks(character);
  const [targetId, setTargetId] = useState("");
  const [aimedTargets, setAimedTargets] = useState<Record<string, "head" | "leg" | "held_item">>({});
  const [busy, setBusy] = useState(false);

  const effectiveTargetId = mesaAttack.targets.some((target) => target.id === targetId && !target.isDead)
    ? targetId
    : mesaAttack.targets.find((target) => !target.isDead)?.id ?? "";

  async function attack(attackId: string, mode?: AttackMode) {
    const availableAttack = attacks.find((item) => item.id === attackId);
    if (!availableAttack) return;
    const context = mode ? { ...availableAttack.context, attackMode: mode } : availableAttack.context;

    if (mesaAttack) {
      if (!effectiveTargetId || busy) return;
      setBusy(true);
      try {
        const resolutionId = crypto.randomUUID();
        const weapon = availableAttack.context.weaponId
          ? character.weapons.find((item) => item.id === availableAttack.context.weaponId)
          : undefined;
        const response = await attackMesa({
          sessionId: mesaAttack.sessionId,
          resolutionId,
          actorId: mesaAttack.actorId,
          targetId: effectiveTargetId,
          weaponId: availableAttack.context.weaponId,
          skillId: weapon?.skill ?? availableAttack.context.skillId,
          attackType: weapon?.attackType ?? availableAttack.context.type,
          attackMode: mode ?? "normal",
          ...(mode === "aimed"
            ? { aimedTarget: aimedTargets[availableAttack.id] ?? "head" }
            : {}),
        });
        mesaAttack.onResult(response.attackResult);
        if (response.weaponDamage) mesaAttack.onWeaponDamage(response.weaponDamage);
        if (response.damageResult) mesaAttack.onDamageResult(response.damageResult);
        if (response.damageError) mesaAttack.onDamageError(response.damageError.message);
        // Ammo is authoritative on the server. The refresh below is the only
        // path that projects the new value back into the sheet; do not apply
        // `response.ammoAfter` optimistically here.
        await mesaAttack.onRefresh();
      } catch (caught) {
        mesaAttack.onError(caught instanceof MesaApiError ? caught.message : "Falha no ataque.");
      } finally {
        setBusy(false);
      }
      return;
    }

    const resolution = rollAttack(character, context);
    if ("error" in resolution) return;
    onUpdate(resolution.character);
    onResult(resolution.result);
  }

  if (!attacks.length) {
    return <p className="sheet-empty">Equipe uma arma ou aumente uma perícia de ataque para rolar.</p>;
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      {mesaAttack && (
        <label style={{ display: "grid", gap: "0.25rem", color: "var(--muted)", fontSize: "0.7rem" }}>
          Alvo
          <select
            value={effectiveTargetId}
            onChange={(event) => setTargetId(event.target.value)}
            disabled={busy || mesaAttack.targets.length === 0}
          >
            {mesaAttack.targets.length === 0 && <option value="">Nenhum alvo disponível</option>}
            {mesaAttack.targets.map((target) => (
              <option key={target.id} value={target.id} disabled={target.isDead}>
                {target.name} · {target.kind === "enemy" ? "Inimigo" : "Personagem"}
                {target.isDead ? " · derrotado" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {attacks.map((availableAttack) => {
        const weaponId = availableAttack.context.weaponId;
        const weapon = weaponId ? character.weapons.find((w) => w.id === weaponId) : null;
        // O seletor depende do TIPO RESOLVIDO do ataque (`weapon.attackType`, que é
        // handgun/smg/rifle/...) — `context.type` é sempre "weapon" e nunca batia
        // com a lista de perícias, então o bloco de Attack Modes nunca aparecia.
        // Mesmo critério do cálculo (`isRangedAttackType`), para UI e resolução não
        // discordarem sobre o que é ataque à distância.
        const isRanged =
          Boolean(weaponId) &&
          isRangedAttackType(
            weapon?.attackType ?? availableAttack.context.type,
            weapon?.skill ?? availableAttack.context.skillId,
          );
        const currentMode = weaponId && weaponAttackModes ? weaponAttackModes[weaponId] ?? "normal" : "normal";
        const isOut = !mesaAttack && weapon?.ammo !== undefined && weapon.ammo <= 0;
        const hasAmmo = weapon?.ammo !== undefined;
        const ammoPercent = hasAmmo ? ((weapon.ammo ?? 0) / (weapon.magazine ?? 1)) * 100 : 100;

        return (
          <div
            key={availableAttack.id}
            style={{
              border: "1px solid #3a4a3d",
              borderRadius: "4px",
              background: "#0f1512",
              overflow: "hidden",
            }}
          >
            {/* Weapon header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0.6rem", borderBottom: "1px solid #2a352c", background: "#141c18" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
                <strong style={{ color: "var(--foreground)", fontSize: "0.8rem" }}>{availableAttack.label}</strong>
                {weapon && (
                  <small style={{ color: "var(--muted)", fontSize: "0.65rem" }}>
                    {weapon.damage}
                    {weapon.rateOfFire ? ` · ROF ${weapon.rateOfFire}` : ""}
                  </small>
                )}
                {!weapon && (
                  <small style={{ color: "var(--muted)", fontSize: "0.65rem" }}>
                    {availableAttack.detail}
                  </small>
                )}
              </div>
              {hasAmmo && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <div style={{ width: "40px", height: "4px", background: "#2a352c", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ width: `${ammoPercent}%`, height: "100%", background: isOut ? "#ff6b6b" : ammoPercent <= 25 ? "#f5a623" : "var(--accent)", transition: "width 0.3s" }} />
                  </div>
                  <small style={{ color: isOut ? "#ff6b6b" : "var(--muted)", fontSize: "0.6rem", fontFamily: "var(--font-geist-mono), monospace" }}>
                    {weapon.ammo}/{weapon.magazine}
                  </small>
                </div>
              )}
            </div>

            {/* Attack modes for ranged weapons */}
            {isRanged && weaponId && (
              <div style={{ display: "flex", gap: "0.2rem", padding: "0.35rem 0.6rem", borderBottom: "1px solid #2a352c", background: "#111915" }}>
                {(mesaAttack ? (["normal", "aimed"] as AttackMode[]) : (["normal", "aimed", "autofire", "suppressive"] as AttackMode[])).map((mode) => {
                  const isActive = currentMode === mode;
                  const info = attackModeLabels[mode];
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onAttackModeChange?.(weaponId, mode)}
                      style={{
                        flex: 1,
                        border: `1px solid ${isActive ? "var(--accent)" : "#3a4a3d"}`,
                        borderRadius: "3px",
                        background: isActive ? "var(--accent)" : "transparent",
                        color: isActive ? "#111700" : "var(--muted)",
                        cursor: "pointer",
                        padding: "0.2rem 0.25rem",
                        fontSize: "0.58rem",
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontWeight: isActive ? 700 : 400,
                        textAlign: "center",
                        lineHeight: 1.3,
                      }}
                    >
                      {info.label}
                      <br />
                      <span style={{ fontSize: "0.5rem", opacity: 0.7 }}>{info.cost} ammo</span>
                    </button>
                  );
                })}
              </div>
            )}

            {mesaAttack && currentMode === "aimed" && (
              <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", padding: "0.35rem 0.6rem", color: "var(--muted)", fontSize: "0.65rem" }}>
                Local visado
                <select
                  value={aimedTargets[availableAttack.id] ?? "head"}
                   onChange={(event) => setAimedTargets((previous) => ({ ...previous, [availableAttack.id]: event.target.value as "head" | "leg" | "held_item" }))}
                  disabled={busy}
                >
                   <option value="head">Cabeça</option>
                   <option value="leg">Perna</option>
                   <option value="held_item">Item empunhado</option>
                </select>
              </label>
            )}

            {/* Roll button */}
            <div style={{ padding: "0.35rem 0.6rem" }}>
              <button
                type="button"
                onClick={() => void attack(availableAttack.id, isRanged ? currentMode : undefined)}
                disabled={isOut || busy || !effectiveTargetId}
                style={{
                  width: "100%",
                  border: `1px solid ${isOut ? "#3a4a3d" : "var(--accent)"}`,
                  borderRadius: "3px",
                  background: isOut ? "transparent" : "transparent",
                  color: isOut ? "#666" : "var(--accent)",
                  cursor: isOut ? "not-allowed" : "pointer",
                  padding: "0.35rem",
                  fontSize: "0.7rem",
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  textAlign: "center",
                }}
              >
                 {busy ? "⏳ Atacando..." : isOut ? "🔫 Sem munição" : "🎲 Rolar ataque"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
