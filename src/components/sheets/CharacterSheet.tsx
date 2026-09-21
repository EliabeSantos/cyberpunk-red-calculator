"use client";

import React, { useState } from "react";

import {
  canUpgradeSkill,
  getSkillUpgradeCost,
  grantImprovementPoints,
  upgradeSkill,
} from "@/lib/progression";
import { equipInventoryItem, isEquippableItem } from "@/lib/inventory";
import { applyReceivedDamage, rollDamageForLastAttack, applyAttackDamage, type DamageApplicationResult } from "@/lib/damage";
import { getSkillBase, calculateEmpFromHumanity, calculateWoundThreshold } from "@/lib/calculations";
import { rollEvasion, reloadWeapon } from "@/lib/attacks";
import { rollDice } from "@/lib/dice";
import { rollSkillCheck } from "@/lib/skills";
import { rollQuickhack } from "@/lib/quickhacks";
import { getQuickhacksForCharacter, quickhackDefinitions, quickhackCategoriesOrder } from "@/data/quickhacks";
import { removeCyberware } from "@/lib/cyberware";
import { adjustHumanity } from "@/lib/humanity";
import type { SkillCheckResult } from "@/lib/skills";
import type { HumanityLossResult } from "@/lib/humanity";
import type { QuickhackRollResult, QuickhackCategory } from "@/lib/quickhacks";
import StorePanel from "@/components/sheets/StorePanel";
import AttackActions from "@/components/combat/AttackActions";
import type { AttackRollResult, DamageRollResult, EvasionRollResult, AttackMode } from "@/types/attack";
import type { AttributeName, Character } from "@/types/character";
import type { SkillCategory } from "@/data/skills";
import { hitLocationLabels, hitLocations, type HitLocation } from "@/types/combat";
import { bodyCriticalInjuries, headCriticalInjuries } from "@/data/criticalInjuries";
import type { CriticalInjury } from "@/data/criticalInjuries";
import { getSellPrice, sellInventoryItem } from "@/lib/store";
import { getCatalogItem } from "@/data/items";
import { getCombatAwarenessTotal, getMakerSpecialtyPoints, getMedicineSpecialtyPoints, getNetActionsPerTurn, getRoleAbilityIPCost, spendIPOnRoleAbility } from "@/lib/roles";
import { roleDefinitions } from "@/data/roles";
import type { RoleAbilityData, RoleAbilityId } from "@/data/roles";

type CharacterSheetProps = {
  character: Character;
  onUpdate: (character: Character) => void;
  onEdit: () => void;
  onNewCharacter: () => void;
};
const statOrder: AttributeName[] = [
  "INT",
  "REF",
  "DEX",
  "TECH",
  "COOL",
  "WILL",
  "LUCK",
  "MOVE",
  "BODY",
  "EMP",
];
const statNames: Record<AttributeName, string> = {
  INT: "Inteligência",
  REF: "Reflexos",
  DEX: "Destreza",
  TECH: "Técnica",
  COOL: "Frieza",
  WILL: "Vontade",
  LUCK: "Sorte",
  MOVE: "Movimento",
  BODY: "Corpo",
  EMP: "Empatia",
};
function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="sheet-empty">{children}</p>;
}

export default function CharacterSheet({
  character,
  onUpdate,
  onEdit,
  onNewCharacter,
}: CharacterSheetProps) {
  const [ipToGrant, setIpToGrant] = useState(0);
  const [lastHumanityLoss, setLastHumanityLoss] =
    useState<HumanityLossResult | null>(null);
  const [lastAttack, setLastAttack] = useState<AttackRollResult | null>(null);
  const [lastDamage, setLastDamage] = useState<DamageRollResult | null>(null);
  const [lastEvasion, setLastEvasion] = useState<EvasionRollResult | null>(null);
  const [lastSkillRoll, setLastSkillRoll] = useState<{ skillId: string; result: SkillCheckResult } | null>(null);
  const [receivedDamage, setReceivedDamage] = useState("");
  const [hitLocation, setHitLocation] = useState<HitLocation>("body");
  const [combatError, setCombatError] = useState("");
  const [lastDamageDealt, setLastDamageDealt] = useState<DamageApplicationResult | null>(null);
  const [lastDamageReceived, setLastDamageReceived] = useState<DamageApplicationResult | null>(null);
  const [lastQuickhack, setLastQuickhack] = useState<QuickhackRollResult | null>(null);
  const [lastInitiative, setLastInitiative] = useState<{ diceRoll: number; refBonus: number; total: number } | null>(null);
  const [manualInjuryLocation, setManualInjuryLocation] = useState<HitLocation>("body");
  const [manualInjuryName, setManualInjuryName] = useState("");
  const [weaponAttackModes, setWeaponAttackModes] = useState<Record<string, AttackMode>>({});
  const [reloadError, setReloadError] = useState("");
  const [rollingQuickhack, setRollingQuickhack] = useState<{ id: string; roll: number } | null>(null);
  const [rollingSkill, setRollingSkill] = useState<{ id: string; roll: number } | null>(null);
  const [quickhackError, setQuickhackError] = useState("");
  const [humanityAdjustOpen, setHumanityAdjustOpen] = useState(false);
  const [humanityAdjustValue, setHumanityAdjustValue] = useState("");
  const [humanityAdjustReason, setHumanityAdjustReason] = useState("");
  const [expandedRoleAbility, setExpandedRoleAbility] = useState<RoleAbilityId | null>(null);
  const categoryOrder: SkillCategory[] = ["awareness", "body", "control", "education", "fighting", "performance", "ranged_weapon", "social", "technique"];
  const statNames: Record<AttributeName, string> = {
    INT: "Inteligência",
    REF: "Reflexos",
    DEX: "Destreza",
    TECH: "Técnica",
    COOL: "Frieza",
    WILL: "Vontade",
    LUCK: "Sorte",
    MOVE: "Movimento",
    BODY: "Corpo",
    EMP: "Empatia",
  };
  const categoryNames: Record<SkillCategory, string> = {
    awareness: "Awareness", body: "Body", control: "Control", education: "Education", fighting: "Fighting", performance: "Performance", ranged_weapon: "Ranged Weapon", social: "Social", technique: "Technique",
  };
  const skillsByCategory = categoryOrder
    .map((category) => [category, Object.entries(character.skills).filter(([, skill]) => skill.category === category)] as const)
    .filter(([, skills]) => skills.length > 0);
  const availableQuickhacks = getQuickhacksForCharacter(character);
  const hasQuickhacks = availableQuickhacks.length > 0;
  const isNetRunner = character.primaryRole === "netrunner" ||
    character.roleAbilities.some((ra) => ra.abilityId === "interface" && ra.rank > 0);
  const availableIP = character.ip;
  function grantIP() {
    const updated = grantImprovementPoints(character, ipToGrant);
    if (updated !== character) {
      onUpdate(updated);
      setIpToGrant(0);
    }
  }
  function improveSkill(skillId: string) {
    const updated = upgradeSkill(character, skillId);
    if (updated) {
      // Clear last skill roll if it's the skill being upgraded
      if (lastSkillRoll?.skillId === skillId) {
        setLastSkillRoll(null);
      }
      onUpdate(updated);
    }
  }
  function improveRole(roleId: import("@/types/roles").RoleId) {
    const updated = spendIPOnRoleAbility(character, roleId);
    if (updated) onUpdate(updated);
  }
  function rollDamage() {
    const resolution = rollDamageForLastAttack(character);
    if ("error" in resolution) return;
    const damageRoll = resolution.result;
    onUpdate(resolution.character);
    setLastDamage(damageRoll);
    setLastDamageDealt(null);
  }
  function handleRollSkillCheck(character: Character, skillId: string) {
    const resolution = rollSkillCheck(character, skillId);
    if ("error" in resolution) return;
    // Show immediate visual feedback with the dice roll
    setRollingSkill({ id: skillId, roll: resolution.result.diceRoll });
    setLastSkillRoll({ skillId, result: resolution.result });
    onUpdate(resolution.character);
    // Clear the rolling indicator after a brief moment
    setTimeout(() => setRollingSkill(null), 1500);
  }
  function handleRollQuickhack(quickhackId: string) {
    const resolution = rollQuickhack(character, quickhackId);
    if ("error" in resolution) {
      setQuickhackError(resolution.error);
      return;
    }
    setQuickhackError("");
    // Show immediate visual feedback with the dice roll
    setRollingQuickhack({ id: quickhackId, roll: resolution.result.roll.rolls[0] });
    setLastQuickhack(resolution.result);
    onUpdate(resolution.character);
    // Clear the rolling indicator after a brief moment
    setTimeout(() => setRollingQuickhack(null), 1500);
  }
  function evade() {
    const resolution = rollEvasion(character);
    if ("error" in resolution) { setCombatError(resolution.error); return; }
    setCombatError(""); setLastEvasion(resolution.result); onUpdate(resolution.character);
  }
  function rollInitiative() {
    const dice = rollDice("1d10");
    const refBonus = character.stats.REF;
    setLastInitiative({ diceRoll: dice.rolls[0], refBonus, total: dice.rolls[0] + refBonus });
  }
  function addManualCriticalInjury() {
    const name = manualInjuryName.trim();
    if (!name) return;
    const table = manualInjuryLocation === "head" ? headCriticalInjuries : bodyCriticalInjuries;
    const template = table.find((inj) => inj.name === name);
    const injury: CriticalInjury = template
      ? { ...template }
      : { roll: 0, name, effect: "", quickFix: "", treatment: "", bonusDamage: 0, location: manualInjuryLocation, modifiers: [] };
    onUpdate({
      ...character,
      combat: {
        ...character.combat,
        criticalInjuries: [...character.combat.criticalInjuries, injury],
      },
    });
    setManualInjuryName("");
  }
  function removeCriticalInjury(index: number) {
    const updated = character.combat.criticalInjuries.filter((_, i) => i !== index);
    onUpdate({
      ...character,
      combat: { ...character.combat, criticalInjuries: updated },
    });
  }
  function handleReload(weaponId: string) {
    const resolution = reloadWeapon(character, weaponId);
    if ("error" in resolution) { setReloadError(resolution.error); return; }
    setReloadError("");
    onUpdate(resolution.character);
  }
  function isRangedWeapon(weapon: { skill?: string }): boolean {
    return ["handgun", "smg", "rifle", "shotgun", "heavy_weapons", "shoulder_arms", "sniper"].includes(weapon.skill ?? "");
  }
  function receiveDamage() {
    const resolution = applyReceivedDamage(character, Number(receivedDamage), hitLocation);
    if ("error" in resolution) { setCombatError(resolution.error); return; }
    setCombatError(""); setReceivedDamage(""); setLastDamageReceived(resolution.result); onUpdate(resolution.character);
  }
  function sellItem(inventoryItemId: string) {
    const result = sellInventoryItem(character, inventoryItemId);
    if ("error" in result) { setCombatError("Não foi possível vender este item."); return; }
    setCombatError(""); onUpdate(result.character);
  }
  function equipItem(inventoryItemId: string) {
    const result = equipInventoryItem(character, inventoryItemId);
    if (!result) return;
    onUpdate(result.character);
    setLastHumanityLoss(result.cyberwareInstallation?.humanityLoss ?? null);
  }
  function openHumanityAdjust() {
    setHumanityAdjustValue(String(character.humanity.current));
    setHumanityAdjustReason("");
    setHumanityAdjustOpen(true);
  }
  function confirmHumanityAdjust() {
    const value = Number(humanityAdjustValue);
    if (!Number.isFinite(value)) return;
    const resolution = adjustHumanity(character, value, humanityAdjustReason || "Ajuste manual");
    if ("error" in resolution) return;
    setHumanityAdjustOpen(false);
    onUpdate(resolution.character);
  }
  function closeHumanityAdjust() {
    setHumanityAdjustOpen(false);
    setHumanityAdjustValue("");
    setHumanityAdjustReason("");
  }
  function openQuickhackPanel() {
    // TODO: implementar se necessário
  }
  return (
    <main className="sheet-shell">
      <nav className="sheet-nav">
        <span>CYBERPUNK RED TOOLKIT</span>
        <div>
          <button onClick={onEdit}>Editar ficha</button>
          <button className="nav-accent" onClick={onNewCharacter}>
            Novo personagem
          </button>
        </div>
      </nav>
      <header className="sheet-hero">
        <div className="sheet-photo">
          {character.identity.photoUrl ? (
            <img
              src={character.identity.photoUrl}
              alt={character.identity.name || "Personagem"}
            />
          ) : (
            <span>SEM FOTO</span>
          )}
        </div>
        <div>
          <p className="eyebrow">Ficha de personagem</p>
          <h1>{character.identity.name || "Sem nome"}</h1>
          <p className="role-line">
            {character.identity.role || "Sem Role"} <span>•</span> Nível{" "}
            {character.identity.level}
          </p>
          <p className="player-line">
            Jogador: {character.identity.player || "Não informado"}
          </p>
        </div>
        <div className="hero-vitals">
          <div>
            <small>HP</small>
            <strong>
              {character.combat.hp.current} <i>/</i> {character.combat.hp.max}
            </strong>
          </div>
          <div>
            <small>Humanidade</small>
            <strong>
              {character.humanity.current} <i>/</i> {character.humanity.max}
            </strong>
          </div>
          <div>
            <small>EMP</small>
            <strong>{calculateEmpFromHumanity(character.humanity.current)}</strong>
          </div>
          <div>
            <small>Armadura</small>
            <strong>
              C {character.combat.armor.body} <i>•</i> H{" "}
              {character.combat.armor.head}
            </strong>
          </div>
        </div>
      </header>
      {lastHumanityLoss && (
        <section className="humanity-result" role="status">
          <strong>{lastHumanityLoss.cyberwareName} instalado</strong>
          <span>Humanity Loss: {lastHumanityLoss.expression ?? "fixa"}</span>
          {lastHumanityLoss.rolls.length > 0 && (
            <span>
              Rolagens:{" "}
              {lastHumanityLoss.rolls.map((roll) => `[${roll}]`).join(" ")}
            </span>
          )}
          <b>
            Perda: {lastHumanityLoss.humanityLost} ·{" "}
            {lastHumanityLoss.humanityBefore} → {lastHumanityLoss.humanityAfter}{" "}
            Humanidade
          </b>
          <button type="button" onClick={() => setLastHumanityLoss(null)}>
            ×
          </button>
        </section>
      )}
      <section className="sheet-layout">
        <aside className="sheet-column">
          <section className="sheet-panel">
            <PanelTitle number="01">Atributos</PanelTitle>
            <div className="stats-list">
              {statOrder.map((stat) => (
                <div key={stat}>
                  <span>{stat}</span>
                  <small>{statNames[stat]}</small>
                  <strong>{character.stats[stat]}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="sheet-panel role-panel">
            <PanelTitle number="02">Role</PanelTitle>
            {character.primaryRole ? character.roleAbilities.map((ability) => {
              const role = roleDefinitions[ability.roleId];
              const abilityData = role.abilityData as RoleAbilityData | undefined;
              const nextRank = ability.rank + 1;
              const cost = getRoleAbilityIPCost(nextRank);
              const isExpanded = expandedRoleAbility === ability.abilityId;
              return (
                <div className="role-ability" key={ability.roleId}>
                  <div className="role-ability-header" onClick={() => setExpandedRoleAbility(isExpanded ? null : ability.abilityId)}>
                    <strong>{role.name}</strong>
                    <span>{role.abilityName} · Rank {ability.rank}</span>
                    <span className="expand-icon">{isExpanded ? "▼" : "▶"}</span>
                  </div>
                  {isExpanded && abilityData && (
                    <div className="role-ability-detail">
                      <div className="detail-section">
                        <small>Descrição</small>
                        <p>{abilityData.description}</p>
                      </div>
                      <div className="detail-section">
                        <small>Efeito no nível {ability.rank}</small>
                        <p>{abilityData.effectsByLevel[ability.rank] || "Nenhum efeito descrito para este nível."}</p>
                      </div>
                    </div>
                  )}
                  {ability.abilityId === "combat_awareness" && <small>Combat Awareness Points: {getCombatAwarenessTotal(character)} / {ability.rank}</small>}
                  {ability.abilityId === "interface" && <small>NET Actions: {getNetActionsPerTurn(ability.rank)}</small>}
                  {ability.abilityId === "maker" && <small>Maker specialty points: {getMakerSpecialtyPoints(ability.rank)}</small>}
                  {ability.abilityId === "medicine" && <small>Medicine specialty points: {getMedicineSpecialtyPoints(ability.rank)}</small>}
                  {ability.rank < 10 && <button type="button" className="upgrade-skill" disabled={availableIP < cost} onClick={() => improveRole(ability.roleId)}>↑ Rank {nextRank} · {cost} IP</button>}
                </div>
              );
            }) : <EmptyState>Nenhuma Role selecionada.</EmptyState>}
          </section>
          <section className="sheet-panel">
            <PanelTitle number="03">Combate</PanelTitle>
            <div className="combat-grid">
              <Metric
                label="HP"
                value={`${character.combat.hp.current} / ${character.combat.hp.max}`}
              />
              <Metric
                label="Stamina"
                value={`${character.combat.stamina.current} / ${character.combat.stamina.max}`}
              />
              <Metric
                label="Armadura cabeça"
                value={character.combat.armor.head}
              />
              <Metric
                label="Armadura corpo"
                value={character.combat.armor.body}
              />
              <Metric
                label="Sorte"
                value={`${character.luck.current} / ${character.luck.max}`}
              />
            </div>
            <div className="combat-action">
              <span>Iniciativa <small>REF ({character.stats.REF}) + 1d10</small></span>
              <button type="button" className="upgrade-skill" onClick={rollInitiative}>Rolar Iniciativa</button>
            </div>
            {lastInitiative && (
              <div className="evasion-result" role="status">
                <span className="roll-formula">
                  REF {lastInitiative.refBonus} + 1d10
                </span>
                <span className="roll-dice">
                  <span className="die-normal">[{lastInitiative.diceRoll}]</span>
                </span>
                <span className="roll-total">= <b>{lastInitiative.total}</b></span>
              </div>
            )}
            <h3>Ataques</h3>
            <AttackActions
              character={character}
              onUpdate={onUpdate}
              onResult={(result) => {
                setLastAttack(result);
                setLastDamage(null);
              }}
              weaponAttackModes={weaponAttackModes}
              onAttackModeChange={(weaponId, mode) => setWeaponAttackModes((prev) => ({ ...prev, [weaponId]: mode }))}
            />
            {(lastAttack ?? character.lastAttack) &&
              (() => {
                const attack = lastAttack ?? character.lastAttack!;
                return (
                  <div className="attack-result" role="status">
                    {/* Header with badges */}
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem" }}>
                      <strong style={{ color: "var(--foreground)", fontSize: "0.8rem" }}>{attack.label}</strong>
                      {attack.critical && <span className="crit-badge">⚡ CRÍTICO</span>}
                      {attack.fumble && <span className="fumble-badge">💥 FALHA CRÍTICA</span>}
                      {!attack.critical && !attack.fumble && (
                        <span style={{ marginLeft: "auto", color: "var(--accent)", fontWeight: 700, fontSize: "0.85rem" }}>
                          {attack.total}
                        </span>
                      )}
                    </div>
                    {/* Formula */}
                    <span className="roll-formula">
                      {attack.stat.id} {attack.stat.value} + {attack.skill.id} {attack.skill.value} + 1d10
                    </span>
                    {/* Dice */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem", margin: "0.15rem 0" }}>
                      {attack.diceRolls?.map((r: any, idx: number) => (
                        <React.Fragment key={idx}>
                          {r.type === "crit" && <strong className="die-crit">[{r.value}]</strong>}
                          {r.type === "crit_add" && <strong className="die-crit">+[{r.value}]</strong>}
                          {r.type === "fumble" && <strong className="die-fumble">[{r.value}]</strong>}
                          {r.type === "fumble_sub" && <strong className="die-fumble">−[{r.value}]</strong>}
                          {r.type === "normal" && <span className="die-normal">[{r.value}]</span>}
                        </React.Fragment>
                      ))}
                    </div>
                    {/* Subtotal */}
                    <span className="roll-subtotal">Dados = {attack.diceTotal}</span>
                    {/* Modifiers */}
                    {attack.modifiers.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", margin: "0.1rem 0" }}>
                        {attack.modifiers.map((modifier, idx) => (
                          <span key={idx} style={{ border: "1px solid #3a4a3d", borderRadius: "3px", padding: "0.1rem 0.3rem", fontSize: "0.6rem", color: "var(--muted)" }}>
                            {modifier.source} {modifier.value >= 0 ? "+" : ""}{modifier.value}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Total */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.2rem", paddingTop: "0.3rem", borderTop: "1px solid #2a352c" }}>
                      <span style={{ color: "var(--muted)", fontSize: "0.65rem" }}>Total</span>
                      <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: "1.1rem", fontFamily: "var(--font-geist-mono), monospace" }}>{attack.total}</span>
                    </div>
                    {/* Damage roll button */}
                    {attack.damageDice && (
                      <button
                        type="button"
                        className="roll-damage"
                        onClick={rollDamage}
                        style={{ marginTop: "0.3rem" }}
                      >
                        🎲 Rolar dano ({attack.damageDice})
                      </button>
                    )}
                    {/* Damage result */}
                    {lastDamage && lastDamage.attackId === attack.attackId && (
                      <div style={{ marginTop: "0.3rem", padding: "0.4rem", border: "1px solid #3a4a3d", borderRadius: "3px", background: "#0f1512" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ color: "var(--muted)", fontSize: "0.65rem" }}>Dano ({lastDamage.damageDice})</span>
                          <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: "0.9rem" }}>{lastDamage.total}</span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.15rem", marginTop: "0.2rem" }}>
                          {lastDamage.roll.rolls.map((roll, idx) => (
                            <span key={idx} style={{ color: roll === 6 ? "var(--accent)" : "var(--foreground)", fontSize: "0.65rem" }}>[{roll}]</span>
                          ))}
                        </div>
                        {(() => {
                          const sixCount = lastDamage.roll.rolls.filter((r) => r === 6).length;
                          if (sixCount >= 2) {
                            return (
                              <div style={{ marginTop: "0.3rem", padding: "0.3rem", border: "1px solid #ff6b6b", borderRadius: "3px", background: "#281815", color: "#ffcfbf", fontSize: "0.65rem", textAlign: "center" }}>
                                ⚠ CRITICAL INJURY! {sixCount} resultados 6 no dano.
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    )}
                  </div>
                );
              })()}
            <h3>Defesa</h3>
            <div className="combat-action">
              <span>Evasion <small>DEX + nível + 1d10</small></span>
              <button type="button" className="upgrade-skill" onClick={evade}>Rolar Evasion</button>
            </div>
            {lastEvasion && (
            <div className="evasion-result" role="status">
              <span className="roll-header">
                {lastEvasion.critical && <span className="crit-badge">⚡ CRÍTICO</span>}
                {lastEvasion.fumble && <span className="fumble-badge">💥 FALHA CRÍTICA</span>}
              </span>
              <span className="roll-formula">
                {lastEvasion.stat.id} {lastEvasion.stat.value} + Evasion {lastEvasion.skill.value} + 1d10
              </span>
              <span className="roll-dice">
                {lastEvasion.diceRolls?.map((r: any, idx: number) => (
                  <React.Fragment key={idx}>
                    {r.type === "crit" && <strong className="die-crit">[{r.value}]</strong>}
                    {r.type === "crit_add" && <strong className="die-crit">+[{r.value}]</strong>}
                    {r.type === "fumble" && <strong className="die-fumble">[{r.value}]</strong>}
                    {r.type === "fumble_sub" && <strong className="die-fumble">−[{r.value}]</strong>}
                    {r.type === "normal" && <span className="die-normal">[{r.value}]</span>}
                    {" "}
                  </React.Fragment>
                ))}
              </span>
              <span className="roll-subtotal">= {lastEvasion.diceTotal}</span>
              <span className="roll-total">= <b>{lastEvasion.total}</b></span>
            </div>
          )}
          <h3>Dano recebido</h3>
            <div className="received-damage">
              <select aria-label="Local do dano" value={hitLocation} onChange={(event) => setHitLocation(event.target.value as HitLocation)}>{hitLocations.map((location) => <option key={location} value={location}>{hitLocationLabels[location]}</option>)}</select>
              <input type="number" min="1" step="1" value={receivedDamage} onChange={(event) => setReceivedDamage(event.target.value)} placeholder="Dano" />
              <button type="button" className="upgrade-skill" onClick={receiveDamage}>Receber dano</button>
            </div>
            {combatError && <p className="form-error">{combatError}</p>}
            <h3>Armadura</h3>
            <div className="combat-grid">
              <div>
                <small>Cabeça</small>
                <strong>{character.combat.armor.head} SP</strong>
                {character.combat.armor.head > 0 && (
                  <button type="button" className="equip-item" onClick={() => onUpdate({ ...character, combat: { ...character.combat, armor: { ...character.combat.armor, head: 0 } } })}>
                    Remover
                  </button>
                )}
              </div>
              <div>
                <small>Corpo e membros</small>
                <strong>{character.combat.armor.body} SP</strong>
                {character.combat.armor.body > 0 && (
                  <button type="button" className="equip-item" onClick={() => onUpdate({ ...character, combat: { ...character.combat, armor: { ...character.combat.armor, body: 0 } } })}>
                    Remover
                  </button>
                )}
              </div>
            </div>
            <h3>Lesões críticas</h3>
            {character.combat.criticalInjuries.length > 0 ? (
              character.combat.criticalInjuries.map((injury, idx) => (
                <div className="critical-injury-detail" key={idx} role="status">
                  <div className="critical-injury-header">
                    <strong>Critical Injury</strong>
                    <span className="injury-field"><small>Localização</small> <strong>{hitLocationLabels[injury.location]}</strong></span>
                    <button type="button" className="upgrade-skill" style={{ marginLeft: "auto" }} onClick={() => removeCriticalInjury(idx)}>✕ Curar</button>
                  </div>
                  <div className="injury-field">
                    <small>Ferimento</small>
                    <strong>{injury.name}</strong>
                  </div>
                  {injury.effect && (
                    <div className="injury-field">
                      <small>Efeito</small>
                      <span>{injury.effect}</span>
                    </div>
                  )}
                  {injury.quickFix && (
                    <div className="injury-field">
                      <small>Quick Fix</small>
                      <span>{injury.quickFix}</span>
                    </div>
                  )}
                  {injury.treatment && (
                    <div className="injury-field">
                      <small>Treatment</small>
                      <span>{injury.treatment}</span>
                    </div>
                  )}
                  <div className="injury-field">
                    <small>Bonus Damage</small>
                    <strong>{injury.bonusDamage}</strong>
                  </div>
                  {injury.deathSavePenalty !== undefined && (
                    <div className="injury-field">
                      <small>Death Save Penalty</small>
                      <strong>{injury.deathSavePenalty}</strong>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <EmptyState>Nenhuma lesão crítica.</EmptyState>
            )}
            {lastDamageReceived?.criticalInjuryTriggered && lastDamageReceived.criticalInjury && (
              <div className="critical-injury-detail" role="status">
                <div className="critical-injury-header">
                  <strong>⚠ Nova Critical Injury (Recently Triggered)</strong>
                  {lastDamageReceived.crossedWoundThreshold && (
                    <span className="seriously-wounded-inline">⚠ Seriously Wounded</span>
                  )}
                </div>
                <div className="injury-field">
                  <small>Ferimento</small>
                  <strong>{lastDamageReceived.criticalInjury.name}</strong>
                </div>
                <div className="injury-field">
                  <small>Efeito</small>
                  <span>{lastDamageReceived.criticalInjury.effect}</span>
                </div>
              </div>
            )}
            <div className="combat-action" style={{ marginTop: "0.5rem" }}>
              <span>Adicionar lesão manual</span>
            </div>
            <div className="received-damage">
              <select
                aria-label="Local da lesão"
                value={manualInjuryLocation}
                onChange={(event) => { setManualInjuryLocation(event.target.value as HitLocation); setManualInjuryName(""); }}
              >
                {hitLocations.map((location) => (
                  <option key={location} value={location}>{hitLocationLabels[location]}</option>
                ))}
              </select>
              <select
                aria-label="Lesão crítica"
                value={manualInjuryName}
                onChange={(event) => setManualInjuryName(event.target.value)}
              >
                <option value="">— Selecionar —</option>
                {(manualInjuryLocation === "head" ? headCriticalInjuries : bodyCriticalInjuries).map((inj) => (
                  <option key={inj.name} value={inj.name}>{inj.name}</option>
                ))}
              </select>
              <input
                type="text"
                value={manualInjuryName}
                onChange={(event) => setManualInjuryName(event.target.value)}
                placeholder="ou digite..."
              />
              <button type="button" className="upgrade-skill" onClick={addManualCriticalInjury} disabled={!manualInjuryName.trim()}>
                Adicionar
              </button>
            </div>
          </section>
          <section className="sheet-panel ip-panel">
            <PanelTitle number="05">Progressão</PanelTitle>
            <p>
              IP disponível <strong>{availableIP}</strong>
            </p>
            <div>
              <input
                type="number"
                min="1"
                value={ipToGrant || ""}
                onChange={(event) =>
                  setIpToGrant(Math.max(0, Number(event.target.value) || 0))
                }
                placeholder="IP"
              />
              <button type="button" onClick={grantIP} disabled={!ipToGrant}>
                Adicionar IP
              </button>
            </div>
            <small>IP é separado e só existe após a criação.</small>
          </section>
          </aside>
        <div className="sheet-main">
          <section className="sheet-panel skills-panel">
          <PanelTitle number="05">
            Perícias <span>{Object.keys(character.skills).length}</span>
          </PanelTitle>
          <div className="skills-groups">
            {skillsByCategory.map(([category, skills]) => (
              <div className="skill-group" key={category}>
                <h3>{categoryNames[category]}</h3>
                {skills.map(([id, skill]) => {
                  const base = getSkillBase(character, id);
                  const cost = getSkillUpgradeCost(skill.level, skill.costMultiplier);
                  const canUpgrade = canUpgradeSkill(character, id);
                  const rollResult = lastSkillRoll?.skillId === id ? lastSkillRoll.result : null;
                  return (
                    <div className="skill-row" key={id}>
                      <span>
                        {skill.name}
                        <small>
                          STAT: {skill.stat} · LEVEL: {skill.level} · BASE: {base}{skill.costMultiplier === 2 ? " · custo x2" : ""}
                        </small>
                      </span>
                      <div className="skill-actions">
                        <button type="button" className="upgrade-skill" disabled={!canUpgrade} onClick={() => improveSkill(id)}>
                          ↑ {cost} IP
                        </button>
                        <button
                          type="button"
                          className="upgrade-skill"
                          onClick={() => handleRollSkillCheck(character, id)}
                          aria-label={`Rolar ${skill.name}`}
                          disabled={rollingSkill?.id === id}
                        >
                          {rollingSkill?.id === id ? (
                            <span className="rolling-indicator">🎲 {rollingSkill.roll}</span>
                          ) : (
                            "🎲"
                          )}
                        </button>
                      </div>
                      <strong>{base}</strong>
                      {rollResult && (
                        <span className="skill-roll-result">
                          <span className="roll-header">
                            {rollResult.critical && <span className="crit-badge">⚡ CRÍTICO</span>}
                            {rollResult.fumble && <span className="fumble-badge">💥 FALHA CRÍTICA</span>}
                          </span>
                          <span className="roll-formula">
                            {rollResult.statId} {rollResult.statBase} + {rollResult.skillName} {rollResult.skillLevel} + 1d10
                          </span>
                          <span className="roll-dice">
                            {rollResult.diceRolls.map((r, idx) => (
                              <React.Fragment key={idx}>
                                {r.type === "crit" && <strong className="die-crit">[{r.value}]</strong>}
                                {r.type === "crit_add" && <strong className="die-crit">+[{r.value}]</strong>}
                                {r.type === "fumble" && <strong className="die-fumble">[{r.value}]</strong>}
                                {r.type === "fumble_sub" && <strong className="die-fumble">−[{r.value}]</strong>}
                                {r.type === "normal" && <span className="die-normal">[{r.value}]</span>}
                                {" "}
                              </React.Fragment>
                            ))}
                          </span>
                          <span className="roll-subtotal">= {rollResult.diceRoll}</span>
                          {rollResult.totalModifier !== 0 && (
                            <span className="roll-mod">
                              {rollResult.totalModifier >= 0 ? "+" : ""}{rollResult.totalModifier}
                            </span>
                          )}
                          <span className="roll-total">= <b>{rollResult.total}</b></span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
        {isNetRunner && (
        <section className="sheet-panel quickhacks-panel">
            <PanelTitle number="06">Quickhacks</PanelTitle>
            {quickhackError && <p className="form-error">{quickhackError}</p>}
            {availableQuickhacks.length === 0 ? (
              <p className="sheet-empty">
                {character.skills.interface?.level > 0
                  ? "Nenhum quickhack disponível."
                  : "Requer perícia Interface (nível 1+) para usar quickhacks."}
              </p>
            ) : (
              <div className="quickhacks-groups">
                {quickhackCategoriesOrder.map((category) => (
                  <div className="quickhack-group" key={category}>
                    <h3>{category}</h3>
                    {availableQuickhacks
                      .filter((qh) => qh.category === category)
                      .map((quickhack) => (
                    <div className="quickhack-row" key={quickhack.id}>
                      <div>
                        <strong>{quickhack.name}</strong>
                        <small>
                          DV: {quickhack.dv} · {quickhack.target} · {quickhack.duration}
                        </small>
                      </div>
                      <div className="quickhack-actions">
                        <button
                          type="button"
                          className="upgrade-skill"
                          onClick={() => handleRollQuickhack(quickhack.id)}
                          aria-label={`Rolar ${quickhack.name}`}
                          disabled={rollingQuickhack?.id === quickhack.id}
                        >
                          {rollingQuickhack?.id === quickhack.id ? (
                            <span className="rolling-indicator">🎲 {rollingQuickhack.roll}</span>
                          ) : (
                            "🎲"
                          )}
                        </button>
                      </div>
                      <strong>DV {quickhack.dv}</strong>
                      {lastQuickhack && lastQuickhack.quickhackId === quickhack.id && (
                        <span className="quickhack-result">
                          <span className="quickhack-roll-breakdown">
                            {lastQuickhack.success ? "✓" : "✗"} Interface {lastQuickhack.skill.value} + {lastQuickhack.roll.expression}: {lastQuickhack.roll.rolls
                              .map((roll) => `[${roll}]`)
                              .join(" ")} = {lastQuickhack.roll.total}
                          </span>
                          <span className="quickhack-total">Total: <b>{lastQuickhack.total}</b> vs DV {quickhack.dv}</span>
                          <small>{quickhack.effect}</small>
                          <small>{quickhack.duration}</small>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          </section>
        )}
      <StorePanel character={character} onUpdate={onUpdate} />
      {character.rollHistory.some(
        (entry) => entry.type === "humanity_loss",
      ) && (
        <section className="sheet-panel roll-history">
          <PanelTitle number="05">Histórico de Humanidade</PanelTitle>
          {character.rollHistory
            .filter((entry) => entry.type === "humanity_loss")
            .slice(0, 5)
            .map((entry) => (
              <div key={entry.id}>
                <strong>{entry.cyberwareName ?? entry.label}</strong>
                <span>
                  {entry.expression}{" "}
                  {entry.rolls.length
                    ? `→ ${entry.rolls.map((roll) => `[${roll}]`).join(" ")} = ${entry.total}`
                    : `→ ${entry.total}`}
                </span>
                <small>
                  {entry.humanityBefore} → {entry.humanityAfter} Humanidade
                </small>
              </div>
            ))}
        </section>
      )}
      <section className="equipment-layout">
        <section className="sheet-panel">
          <PanelTitle number="05">Armas</PanelTitle>
          {character.weapons.length ? (
            <div className="equipment-list">
              {character.weapons.map((weapon) => (
                <article key={weapon.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <h3>{weapon.name}</h3>
                      <p>
                        {weapon.damage}{" "}
                        {weapon.rateOfFire ? `• ROF ${weapon.rateOfFire}` : ""}
                      </p>
                      <small>
                        {weapon.skill
                          ? `Perícia: ${weapon.skill}`
                          : "Sem perícia definida"}
                      </small>
                      {weapon.magazine !== undefined && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.25rem" }}>
                          <small style={{ color: (weapon.ammo ?? 0) <= 0 ? "#ff6b6b" : "var(--muted)" }}>
                            Munição: {weapon.ammo ?? 0}/{weapon.magazine}
                          </small>
                          <button
                            type="button"
                            className="upgrade-skill"
                            onClick={() => handleReload(weapon.id)}
                            disabled={(weapon.ammo ?? 0) >= weapon.magazine}
                            style={{ fontSize: "0.6rem", padding: "0.15rem 0.3rem" }}
                          >
                            ↻ Recarregar
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onUpdate({ ...character, weapons: character.weapons.filter((w) => w.id !== weapon.id) })}
                      style={{ border: "1px solid var(--accent)", background: "transparent", color: "var(--accent)", cursor: "pointer", padding: ".2rem .4rem", fontSize: ".67rem", marginTop: ".25rem", flexShrink: 0 }}
                    >
                      Remover
                    </button>
                  </div>
                </article>
              ))}
              {reloadError && <p className="form-error" style={{ marginTop: "0.5rem" }}>{reloadError}</p>}
            </div>
          ) : (
            <EmptyState>Nenhuma arma equipada.</EmptyState>
          )}
        </section>
        <section className="sheet-panel">
          <PanelTitle number="06">Cyberware</PanelTitle>
          {character.cyberware.length ? (
            <div className="equipment-list">
              {character.cyberware.map((item) => (
                <article key={item.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                    <div>
                      <h3>{item.name}</h3>
                      <small>
                        {item.humanityLoss
                          ? `Perda de Humanidade: ${item.humanityLoss}`
                          : "Sem perda de Humanidade"}
                        {item.isBorgware ? " · Borgware" : ""}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="equip-item"
                      onClick={() => onUpdate(removeCyberware(character, item.id))}
                      style={{ marginTop: "0.25rem" }}
                    >
                      Remover
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState>Nenhum cyberware instalado.</EmptyState>
          )}
        </section>
        <section className="sheet-panel">
          <PanelTitle number="07">Inventário</PanelTitle>
          {character.inventory.length ? (
            <ul className="inventory-list">
              {character.inventory.map((item) => (
                <li key={item.id}>
                  <strong>{item.quantity}×</strong>
                  <span>{item.name}{item.catalogItemId && (() => { const catalogItem = getCatalogItem(item.catalogItemId); return catalogItem ? <small>Compra: €$ {catalogItem.price.toLocaleString("pt-BR")} · Venda: €$ {getSellPrice(catalogItem.price).toLocaleString("pt-BR")}/un.</small> : null; })()}</span>
                  {item.catalogItemId && <button type="button" className="equip-item" onClick={() => sellItem(item.id)}>Vender 1</button>}
                  {isEquippableItem(item) && (
                    <button
                      type="button"
                      className="equip-item"
                      onClick={() => equipItem(item.id)}
                    >
                      {item.category === "cyberware" ? "Instalar" : "Equipar"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="equip-item"
                    onClick={() => onUpdate({ ...character, inventory: character.inventory.filter((i) => i.id !== item.id) })}
                  >
                    Remover
                  </button>
                  {item.notes && <small>{item.notes}</small>}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Inventário vazio.</EmptyState>
          )}
        </section>
      </section>
        </div>
      {humanityAdjustOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeHumanityAdjust}>
          <section className="store-panel store-modal" role="dialog" aria-modal="true" aria-label="Ajustar Humanity" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="close-modal" onClick={closeHumanityAdjust} aria-label="Fechar">×</button>
            <div className="store-heading">
              <div>
                <p className="eyebrow">Humanidade</p>
                <h2>Ajustar Humanity Atual</h2>
              </div>
            </div>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <small>Current Humanity</small>
                <strong style={{ fontSize: "1.5rem" }}>{character.humanity.current} / {character.humanity.max}</strong>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.35rem" }}>
                  <small>Novo valor</small>
                  <input
                    type="number"
                    min="0"
                    max={character.humanity.max}
                    value={humanityAdjustValue}
                    onChange={(event) => setHumanityAdjustValue(event.target.value)}
                    placeholder="0"
                    style={{ width: "100%", marginTop: "0.25rem" }}
                  />
                </label>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.35rem" }}>
                  <small>Motivo (opcional)</small>
                  <input
                    type="text"
                    value={humanityAdjustReason}
                    onChange={(event) => setHumanityAdjustReason(event.target.value)}
                    placeholder="Ex: Cyberware removido por engano"
                    style={{ width: "100%", marginTop: "0.25rem" }}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                <button type="button" className="equip-item" onClick={closeHumanityAdjust}>Cancelar</button>
                <button type="button" className="upgrade-skill" onClick={confirmHumanityAdjust} style={{ background: "var(--accent)", color: "#111700" }}>Confirmar</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
    </main>
  );
}

function PanelTitle({
  number,
  children,
}: {
  number: string;
  children: React.ReactNode;
}) {
  return (
    <h2 className="panel-title">
      <span>{number}</span>
      {children}
    </h2>
  );
}
function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}