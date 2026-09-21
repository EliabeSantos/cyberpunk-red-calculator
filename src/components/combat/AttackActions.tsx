"use client";

import { getAvailableAttacks, rollAttack } from "@/lib/attacks";
import type { AttackRollResult, AttackMode } from "@/types/attack";
import type { Character } from "@/types/character";

type Props = {
  character: Character;
  onUpdate: (character: Character) => void;
  onResult: (result: AttackRollResult) => void;
  weaponAttackModes?: Record<string, AttackMode>;
  onAttackModeChange?: (weaponId: string, mode: AttackMode) => void;
};

const attackModeLabels: Record<AttackMode, { label: string; cost: string }> = {
  normal: { label: "Normal", cost: "1" },
  aimed: { label: "Aimed", cost: "1" },
  autofire: { label: "Autofire", cost: "10" },
  suppressive: { label: "Suppressive", cost: "10" },
};

const rangedWeaponSkills = ["handgun", "smg", "rifle", "shotgun", "heavy_weapons", "shoulder_arms", "sniper"];

export default function AttackActions({ character, onUpdate, onResult, weaponAttackModes, onAttackModeChange }: Props) {
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

  if (!attacks.length) {
    return <p className="sheet-empty">Equipe uma arma ou aumente uma perícia de ataque para rolar.</p>;
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      {attacks.map((availableAttack) => {
        const weaponId = availableAttack.context.weaponId;
        const weapon = weaponId ? character.weapons.find((w) => w.id === weaponId) : null;
        const isRanged = weaponId && rangedWeaponSkills.includes(availableAttack.context.type as string);
        const currentMode = weaponId && weaponAttackModes ? weaponAttackModes[weaponId] ?? "normal" : "normal";
        const isOut = weapon?.ammo !== undefined && weapon.ammo <= 0;
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
                {(["normal", "aimed", "autofire", "suppressive"] as AttackMode[]).map((mode) => {
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

            {/* Roll button */}
            <div style={{ padding: "0.35rem 0.6rem" }}>
              <button
                type="button"
                onClick={() => attack(availableAttack.id, isRanged ? currentMode : undefined)}
                disabled={isOut}
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
                {isOut ? "🔫 Sem munição" : "🎲 Rolar ataque"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
