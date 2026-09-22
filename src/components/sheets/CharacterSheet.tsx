"use client";

import React, { useState } from "react";
import Link from "next/link";

import {
  canUpgradeSkill,
  getSkillUpgradeCost,
  grantImprovementPoints,
  upgradeSkill,
} from "@/lib/progression";
import { equipInventoryItem, isEquippableItem } from "@/lib/inventory";
import { applyReceivedDamage, rollDamageForLastAttack, applyAttackDamage, rollDeathSave, applyFirstAid, type DamageApplicationResult } from "@/lib/damage";
import { getSkillBase, calculateEmpFromHumanity, calculateWoundThreshold, calculateHPStatus } from "@/lib/calculations";
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
import DiceDrawer from "@/components/dice/DiceDrawer";
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
  const [lastInitiative, setLastInitiative] = useState<{ diceRoll: number; refBonus: number; total: number; critical: boolean; fumble: boolean } | null>(null);
  const [manualInjuryLocation, setManualInjuryLocation] = useState<HitLocation>("body");
  const [manualInjuryName, setManualInjuryName] = useState("");
  const [weaponAttackModes, setWeaponAttackModes] = useState<Record<string, AttackMode>>({});
  const [reloadError, setReloadError] = useState("");
  const [rollingQuickhack, setRollingQuickhack] = useState<{ id: string; roll: number } | null>(null);
  const [rollingSkill, setRollingSkill] = useState<{ id: string; roll: number } | null>(null);
  const [rollingInitiative, setRollingInitiative] = useState<number | null>(null);
  const [rollingEvasion, setRollingEvasion] = useState<number | null>(null);
  const [quickhackError, setQuickhackError] = useState("");
  const [diceDrawerOpen, setDiceDrawerOpen] = useState(false);
  const [humanityAdjustOpen, setHumanityAdjustOpen] = useState(false);
  const [humanityAdjustValue, setHumanityAdjustValue] = useState("");
  const [humanityAdjustReason, setHumanityAdjustReason] = useState("");
  const [expandedRoleAbility, setExpandedRoleAbility] = useState<RoleAbilityId | null>(null);
  const [lastDeathSave, setLastDeathSave] = useState<import("@/lib/damage").DeathSaveResult | null>(null);
  const [rollingDeathSave, setRollingDeathSave] = useState(false);
  const [firstAidMessage, setFirstAidMessage] = useState("");
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
    setCombatError("");
    setRollingEvasion(resolution.result.naturalRoll);
    setLastEvasion(resolution.result);
    onUpdate(resolution.character);
    setTimeout(() => setRollingEvasion(null), 2000);
  }
  function rollInitiative() {
    const dice = rollDice("1d10");
    const rollValue = dice.rolls[0];
    const refBonus = character.stats.REF;
    const isCritical = rollValue === 10;
    const isFumble = rollValue === 1;
    let diceTotal = rollValue;

    // Exploding dice: crit on 10 adds another d10, fumble on 1 subtracts another d10
    let extraRoll = 0;
    if (isCritical) {
      const extra = rollDice("1d10");
      extraRoll = extra.rolls[0];
      diceTotal += extraRoll;
    } else if (isFumble) {
      const extra = rollDice("1d10");
      extraRoll = extra.rolls[0];
      diceTotal -= extraRoll;
    }

    const total = diceTotal + refBonus;
    setRollingInitiative(rollValue);
    setLastInitiative({ diceRoll: rollValue, refBonus, total, critical: isCritical, fumble: isFumble });
    const allRolls = isCritical
      ? [rollValue, extraRoll]
      : isFumble
        ? [rollValue, extraRoll]
        : [rollValue];
    const expression = isCritical
      ? `REF ${refBonus} + 1d10 (crítico!)`
      : isFumble
        ? `REF ${refBonus} + 1d10 (falha crítica!)`
        : `REF ${refBonus} + 1d10`;
    const entry: import("@/types/character").RollHistoryEntry = {
      id: crypto.randomUUID(),
      type: "free_roll",
      label: "Iniciativa",
      characterId: character.id,
      expression,
      rolls: allRolls,
      total,
      timestamp: new Date().toISOString(),
    };
    onUpdate({ ...character, rollHistory: [entry, ...character.rollHistory] });
    setTimeout(() => setRollingInitiative(null), 2000);
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
  function handleDeathSave() {
    setRollingDeathSave(true);
    setLastDeathSave(null);
    const resolution = rollDeathSave(character);
    setLastDeathSave(resolution.result);
    onUpdate(resolution.character);
    setTimeout(() => setRollingDeathSave(false), 1500);
  }
  function handleFirstAid() {
    const resolution = applyFirstAid(character);
    if (resolution.restored) {
      setFirstAidMessage("First Aid bem-sucedido! Personagem retornado para 1 HP.");
      setLastDeathSave(null);
      onUpdate(resolution.character);
      setTimeout(() => setFirstAidMessage(""), 3000);
    }
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
          <button onClick={() => setDiceDrawerOpen(true)}>🎲 Dados</button>
          <Link href="/gm">
            🎭 Área do Mestre
          </Link>
          <Link href="/gm/encounters">
            ⚔️ Encontros
          </Link>
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
            {(() => {
              const hpStatus = calculateHPStatus(character.combat.hp.current, character.combat.hp.max, character.combat.isDead);
              const statusLabels: Record<import("@/lib/calculations").HPStatus, string> = {
                normal: "Normal",
                seriously_wounded: "S. Wounded",
                mortally_wounded: "M. Wounded",
                dead: "Dead",
              };
              const statusClasses: Record<import("@/lib/calculations").HPStatus, string> = {
                normal: "hp-status-normal",
                seriously_wounded: "hp-status-seriously-wounded",
                mortally_wounded: "hp-status-mortally-wounded",
                dead: "hp-status-dead",
              };
              return (
                <span className={`hp-status-badge hero-hp-status ${statusClasses[hpStatus]}`}>
                  {statusLabels[hpStatus]}
                </span>
              );
            })()}
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
            </div>
            {(() => {
              const hpStatus = calculateHPStatus(character.combat.hp.current, character.combat.hp.max, character.combat.isDead);
              const woundThreshold = calculateWoundThreshold(character.combat.hp.max);
              const statusLabels: Record<import("@/lib/calculations").HPStatus, string> = {
                normal: "Normal",
                seriously_wounded: "Seriously Wounded",
                mortally_wounded: "Mortally Wounded",
                dead: "Dead",
              };
              const statusClasses: Record<import("@/lib/calculations").HPStatus, string> = {
                normal: "hp-status-normal",
                seriously_wounded: "hp-status-seriously-wounded",
                mortally_wounded: "hp-status-mortally-wounded",
                dead: "hp-status-dead",
              };
              return (
                <div className="hp-status-section">
                  <div className="hp-status-row">
                    <span className={`hp-status-badge ${statusClasses[hpStatus]}`}>
                      {statusLabels[hpStatus]}
                    </span>
                    {hpStatus === "seriously_wounded" && (
                      <span className="hp-status-penalty">−2 em todas as ações</span>
                    )}
                    {hpStatus === "seriously_wounded" && (
                      <span className="hp-status-threshold">Threshold: {woundThreshold}</span>
                    )}
                  </div>
                  {hpStatus === "mortally_wounded" && (
                    <div className="death-save-section">
                      <div className="death-save-info">
                        <span className="death-save-dc">DC: {character.combat.deathSaveDC}</span>
                        <span className="death-save-failures">Falhas: {character.combat.deathSaveFailures}</span>
                      </div>
                      <div className="death-save-actions">
                        <button
                          type="button"
                          className="death-save-btn"
                          onClick={handleDeathSave}
                          disabled={rollingDeathSave || character.combat.isDead}
                        >
                          {rollingDeathSave ? "🎲 Rollando..." : "🎲 Death Save (1d10 vs DC)"}
                        </button>
                        <button
                          type="button"
                          className="first-aid-btn"
                          onClick={handleFirstAid}
                        >
                          🩹 First Aid (→ 1 HP)
                        </button>
                      </div>
                      {lastDeathSave && (
                        <div className={`death-save-result ${lastDeathSave.success ? "death-save-success" : "death-save-fail"}`}>
                          <span>
                            {lastDeathSave.success ? "✓ Sucesso!" : "✗ Falha!"}{" "}
                            1d10 [{lastDeathSave.diceRoll}] vs DC {lastDeathSave.dc}
                          </span>
                          {!lastDeathSave.success && (
                            <span className="death-save-next-dc">
                              Próximo DC: {Math.max(0, lastDeathSave.dc - 1)}
                            </span>
                          )}
                        </div>
                      )}
                      {firstAidMessage && (
                        <div className="first-aid-message">{firstAidMessage}</div>
                      )}
                    </div>
                  )}
                  {hpStatus === "dead" && (
                    <div className="death-save-section">
                      <div className="hp-status-dead-message">
                        ☠️ Personagem morreu.
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="combat-armor">
              <div className="combat-armor-slot">
                <small>Cabeça</small>
                <strong>{character.combat.armor.head} SP</strong>
                {character.combat.armor.head > 0 && (
                  <button type="button" className="equip-item" onClick={() => onUpdate({ ...character, combat: { ...character.combat, armor: { ...character.combat.armor, head: 0 } } })}>
                    Remover
                  </button>
                )}
              </div>
              <div className="combat-armor-slot">
                <small>Corpo e membros</small>
                <strong>{character.combat.armor.body} SP</strong>
                {character.combat.armor.body > 0 && (
                  <button type="button" className="equip-item" onClick={() => onUpdate({ ...character, combat: { ...character.combat, armor: { ...character.combat.armor, body: 0 } } })}>
                    Remover
                  </button>
                )}
              </div>
            </div>
            <div className="combat-rolls-group">
              <div className="initiative-section">
                <div className="initiative-header">
                  <div className="initiative-info">
                    <span className="initiative-label">Iniciativa</span>
                    <span className="initiative-formula">REF {character.stats.REF} + 1d10</span>
                  </div>
                  <button
                    type="button"
                    className="initiative-roll-btn"
                    onClick={rollInitiative}
                    disabled={rollingInitiative !== null}
                  >
                    {rollingInitiative !== null ? (
                      <span className="rolling-indicator">🎲 {rollingInitiative}</span>
                    ) : (
                      "🎲 Rolar"
                    )}
                  </button>
                </div>
                {lastInitiative && (
                  <div className="initiative-result" role="status">
                    <div className="initiative-result-header">
                      {lastInitiative.critical && <span className="crit-badge">⚡ CRÍTICO</span>}
                      {lastInitiative.fumble && <span className="fumble-badge">💥 FALHA CRÍTICA</span>}
                    </div>
                    <span className="initiative-result-formula">
                      REF {lastInitiative.refBonus} + 1d10 [{lastInitiative.diceRoll}]
                    </span>
                    <span className="initiative-result-total">{lastInitiative.total}</span>
                  </div>
                )}
              </div>
              <div className="evasion-section">
                <div className="evasion-header">
                  <div className="evasion-info">
                    <span className="evasion-label">Evasion</span>
                    <span className="evasion-formula">DEX + Nível + 1d10</span>
                  </div>
                  <button
                    type="button"
                    className="evasion-roll-btn"
                    onClick={evade}
                    disabled={rollingEvasion !== null}
                  >
                    {rollingEvasion !== null ? (
                      <span className="rolling-indicator">🎲 {rollingEvasion}</span>
                    ) : (
                      "🎲 Rolar"
                    )}
                  </button>
                </div>
                {lastEvasion && (
                  <div className="evasion-result" role="status">
                    <div className="evasion-result-header">
                      {lastEvasion.critical && <span className="crit-badge">⚡ CRÍTICO</span>}
                      {lastEvasion.fumble && <span className="fumble-badge">💥 FALHA CRÍTICA</span>}
                    </div>
                    <span className="evasion-result-formula">
                      {lastEvasion.stat.id} {lastEvasion.stat.value} + Evasion {lastEvasion.skill.value} + 1d10
                    </span>
                    <div className="evasion-result-dice">
                      {lastEvasion.diceRolls?.map((r: any, idx: number) => (
                        <React.Fragment key={idx}>
                          {r.type === "crit" && <strong className="die-crit">[{r.value}]</strong>}
                          {r.type === "crit_add" && <strong className="die-crit">+[{r.value}]</strong>}
                          {r.type === "fumble" && <strong className="die-fumble">[{r.value}]</strong>}
                          {r.type === "fumble_sub" && <strong className="die-fumble">−[{r.value}]</strong>}
                          {r.type === "normal" && <span className="die-normal">[{r.value}]</span>}
                        </React.Fragment>
                      ))}
                      <span className="evasion-result-subtotal">= {lastEvasion.diceTotal}</span>
                    </div>
                    <div className="evasion-result-footer">
                      <span className="evasion-result-total-label">Total</span>
                      <span className="evasion-result-total">{lastEvasion.total}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
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
          <h3>Dano recebido</h3>
            <div className="damage-input-section">
              <div className="damage-input-row">
                <label className="damage-label">
                  <span className="label-text">Local</span>
                  <select
                    aria-label="Local do dano"
                    value={hitLocation}
                    onChange={(event) => setHitLocation(event.target.value as HitLocation)}
                    className="damage-select"
                  >
                    {hitLocations.map((location) => (
                      <option key={location} value={location}>
                        {hitLocationLabels[location]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="damage-label">
                  <span className="label-text">Valor</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={receivedDamage}
                    onChange={(event) => setReceivedDamage(event.target.value)}
                    placeholder="0"
                    className="damage-input"
                  />
                </label>
              </div>
              <button
                type="button"
                className="apply-damage-button"
                onClick={receiveDamage}
                disabled={!receivedDamage || Number(receivedDamage) <= 0}
              >
                ⚔ Aplicar Dano
              </button>
            </div>
            {combatError && <p className="form-error">{combatError}</p>}
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
            <h3>Adicionar lesão manual</h3>
            <div className="damage-input-section injury-input-section">
              <div className="damage-input-row">
                <label className="damage-label">
                  <span className="label-text">Local</span>
                  <select
                    aria-label="Local da lesão"
                    value={manualInjuryLocation}
                    onChange={(event) => { setManualInjuryLocation(event.target.value as HitLocation); setManualInjuryName(""); }}
                    className="damage-select"
                  >
                    {hitLocations.map((location) => (
                      <option key={location} value={location}>{hitLocationLabels[location]}</option>
                    ))}
                  </select>
                </label>
                <label className="damage-label">
                  <span className="label-text">Lesão</span>
                  <select
                    aria-label="Lesão crítica"
                    value={manualInjuryName}
                    onChange={(event) => setManualInjuryName(event.target.value)}
                    className="damage-select"
                  >
                    <option value="">— Selecionar —</option>
                    {(manualInjuryLocation === "head" ? headCriticalInjuries : bodyCriticalInjuries).map((inj) => (
                      <option key={inj.name} value={inj.name}>{inj.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="damage-label">
                <span className="label-text">Ou digite um nome</span>
                <input
                  type="text"
                  value={manualInjuryName}
                  onChange={(event) => setManualInjuryName(event.target.value)}
                  placeholder="Nome da lesão..."
                  className="damage-input injury-text-input"
                />
              </label>
              <button
                type="button"
                className="apply-injury-button"
                onClick={addManualCriticalInjury}
                disabled={!manualInjuryName.trim()}
              >
                ➕ Adicionar Lesão
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
    <DiceDrawer
      open={diceDrawerOpen}
      onClose={() => setDiceDrawerOpen(false)}
      rollHistory={character.rollHistory}
      onFreeRoll={(entry) => onUpdate({ ...character, rollHistory: [entry, ...character.rollHistory] })}
    />
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