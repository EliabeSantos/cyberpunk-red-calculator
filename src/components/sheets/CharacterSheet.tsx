"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

import {
  canUpgradeSkill,
  canUpgradeSpecialization,
  getMartialArtsPoints,
  getSkillUpgradeCost,
  getSpecializationCost,
  grantImprovementPoints,
  upgradeSkill,
  upgradeSpecialization,
  downgradeSpecialization,
} from "@/lib/progression";
import { equipInventoryItem, isEquippableItem } from "@/lib/inventory";
import { applyHealingItem, getItemHealAmount, isHealingItem } from "@/lib/healing";
import { applyReceivedDamage, rollDamageForLastAttack, applyAttackDamage, rollDeathSave, applyFirstAid, rollFirstAid } from "@/lib/damage";
import { getSkillBase, calculateEmpFromHumanity, calculateWoundThreshold, calculateHPStatus } from "@/lib/calculations";
import { rollEvasion, reloadWeapon } from "@/lib/attacks";
import { getInitiativeModifiers, rollInitiative as rollInitiativeRoll, type InitiativeRollResult } from "@/lib/initiative";
import { DEFAULT_TURN_STATE, listSpecialMoveAvailability, resolveSpecialMove, refundSpecialMove, unlockSpecialMove, type SpecialMoveResolution, type TurnState } from "@/lib/specialMoves";
import type { SpecialMove } from "@/data/specialMoves";
import { rollSkillCheck } from "@/lib/skills";
import { rollQuickhack } from "@/lib/quickhacks";
import { getQuickhacksForCharacter, quickhackDefinitions, quickhackCategoriesOrder } from "@/data/quickhacks";
import { removeCyberware } from "@/lib/cyberware";
import { getCyberwareMoveModifier, deactivateCyberware, getInstalledCyberwareControls, runCyberwareAction, toggleCyberwareActivation } from "@/lib/cyberwareEffects";
import { adjustHumanity } from "@/lib/humanity";
import type { SkillCheckResult } from "@/lib/skills";
import type { HumanityLossResult } from "@/lib/humanity";
import type { QuickhackRollResult, QuickhackCategory } from "@/lib/quickhacks";
import StorePanel from "@/components/sheets/StorePanel";
import DiceDrawer from "@/components/dice/DiceDrawer";
import AttackActions from "@/components/combat/AttackActions";
import MesaEntry from "@/components/mesa/MesaEntry";
import type { DiscordConsent } from "@/lib/discord/consent";
import type { AttackRollResult, DamageRollResult, EvasionRollResult, AttackMode } from "@/types/attack";
import type { AttributeName, Character, Skill } from "@/types/character";
import { MARTIAL_ARTS_FORMS, isMartialArtFormSkill, type SkillCategory } from "@/data/skills";
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
  /** Consentimento do usuário para enviar rolagens ao Discord ("null" = ainda não respondeu). */
  discordConsent: DiscordConsent | null;
  onDiscordConsentChange: (consent: DiscordConsent) => void;
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
  discordConsent,
  onDiscordConsentChange,
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
  const [healNotice, setHealNotice] = useState<{ text: string; isError: boolean } | null>(null);
  const [equipError, setEquipError] = useState("");
  const [cyberwareNotice, setCyberwareNotice] = useState("");
  const [lastQuickhack, setLastQuickhack] = useState<QuickhackRollResult | null>(null);
  const [lastInitiative, setLastInitiative] = useState<InitiativeRollResult | null>(null);
  /** Estado do turno alimenta os requisitos dos Special Moves — o app não conta rodadas (ver PENDENCIAS.md). */
  const [turnState, setTurnState] = useState<TurnState>(DEFAULT_TURN_STATE);
  const [specialMoveOutcome, setSpecialMoveOutcome] = useState<SpecialMoveResolution | { error: string } | null>(null);
  const [specialMoveHeadAim, setSpecialMoveHeadAim] = useState<Record<string, boolean>>({});
  /** Cards de Special Move abertos. Todo mundo começa recolhido para a seção não engolir a tela. */
  const [openSpecialMoves, setOpenSpecialMoves] = useState<Record<string, boolean>>({});
  const [manualInjuryLocation, setManualInjuryLocation] = useState<HitLocation>("body");
  const [manualInjuryName, setManualInjuryName] = useState("");
  const [weaponAttackModes, setWeaponAttackModes] = useState<Record<string, AttackMode>>({});
  const [reloadError, setReloadError] = useState("");
  const [rollingQuickhack, setRollingQuickhack] = useState<{ id: string; roll: number } | null>(null);
  const [rollingSkill, setRollingSkill] = useState<{ id: string; roll: number } | null>(null);
  const [rollingInitiative, setRollingInitiative] = useState<number | null>(null);
  const [rollingEvasion, setRollingEvasion] = useState<number | null>(null);
  const [quickhackError, setQuickhackError] = useState("");
  const [expandedQuickhack, setExpandedQuickhack] = useState<string | null>(null);
  const [diceDrawerOpen, setDiceDrawerOpen] = useState(false);
  const [humanityAdjustOpen, setHumanityAdjustOpen] = useState(false);
  const [humanityAdjustValue, setHumanityAdjustValue] = useState("");
  const [humanityAdjustReason, setHumanityAdjustReason] = useState("");
  const [expandedRoleAbility, setExpandedRoleAbility] = useState<RoleAbilityId | null>(null);
  const [lastDeathSave, setLastDeathSave] = useState<import("@/lib/damage").DeathSaveResult | null>(null);
  const [rollingDeathSave, setRollingDeathSave] = useState(false);
  const [firstAidMessage, setFirstAidMessage] = useState("");
  const [lastFirstAidRoll, setLastFirstAidRoll] = useState<import("@/lib/damage").FirstAidRollResult | null>(null);
  const [rollingFirstAid, setRollingFirstAid] = useState(false);
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  // Modificadores de Iniciativa já valendo (cyberware, lesões e lesão grave), para a fórmula do cabeçalho
  const initiativeModifiers = getInitiativeModifiers(character);
  const installedCyberwareEffects = getInstalledCyberwareControls(character);
  const cyberwareMoveBonus = getCyberwareMoveModifier(character);
  const initiativeRerollCyberware = installedCyberwareEffects.find(
    (entry) => entry.action?.type === "reroll_initiative" && entry.actionEnabled,
  );

  // Gaveta do nav (mobile): ESC fecha e o scroll da página trava enquanto aberta.
  useEffect(() => {
    if (!navDrawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavDrawerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [navDrawerOpen]);
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
    .map((category) => [category, Object.entries(character.skills).filter(([id, skill]) => skill.category === category && !isMartialArtFormSkill(id))] as const)
    .filter(([, skills]) => skills.length > 0)
    .sort((a, b) => a[1].length - b[1].length);
  
  // Balance categories into 2 columns to minimize vertical waste
  const col1: typeof skillsByCategory = [];
  const col2: typeof skillsByCategory = [];
  let col1Count = 0;
  let col2Count = 0;
  for (const item of skillsByCategory) {
    if (col1Count <= col2Count) {
      col1.push(item);
      col1Count += item[1].length;
    } else {
      col2.push(item);
      col2Count += item[1].length;
    }
  }
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
  function upgradeSpec(skillId: string) {
    const updated = upgradeSpecialization(character, skillId);
    if (updated) onUpdate(updated);
  }
  function downgradeSpec(skillId: string) {
    const updated = downgradeSpecialization(character, skillId);
    if (updated) onUpdate(updated);
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
  function rollInitiative(consumeCyberwareId?: string) {
    // Cálculo morava aqui dentro; agora passa pelo motor para valer lesão/lesão grave
    // e para os testes exercitarem o mesmo caminho da ficha.
    const outcome = rollInitiativeRoll(character);
    setRollingInitiative(outcome.result.diceRoll);
    setLastInitiative(outcome.result);

    // Peça ativada para repetir Iniciativa (Reflex Tuner): usar desliga a peça.
    const nextCharacter = consumeCyberwareId
      ? deactivateCyberware(outcome.character, consumeCyberwareId)
      : outcome.character;
    onUpdate(nextCharacter);
    setTimeout(() => setRollingInitiative(null), 2000);
  }

  /** Usa um Special Move: os requisitos já estão validados; o ataque entra no fluxo normal da ficha. */
  function useSpecialMove(move: SpecialMove) {
    const outcome = resolveSpecialMove(character, move, turnState, { headAim: Boolean(specialMoveHeadAim[move.id]) });
    setSpecialMoveOutcome(outcome);
    if ("error" in outcome) return;
    // Abre o card para o resultado ficar visível sem precisar procurar.
    setOpenSpecialMoves((previous) => ({ ...previous, [move.id]: true }));
    if (outcome.kind === "attack") {
      setLastAttack(outcome.attack);
      setLastDamage(null);
    }
    if (outcome.kind !== "passive") onUpdate(outcome.character);
  }

  function toggleSpecialMove(moveId: string) {
    setOpenSpecialMoves((previous) => ({ ...previous, [moveId]: !previous[moveId] }));
  }

  /** Desbloqueia um Special Move pagando 1 ponto do nível da forma correspondente. */
  function unlockSpecialMoveCard(move: SpecialMove) {
    const updated = unlockSpecialMove(character, move);
    if (updated) onUpdate(updated);
    // Limpa o resultado antigo (um "travado" ou o resultado daquele move) para não ficar defasado.
    setSpecialMoveOutcome((previous) =>
      previous && ("error" in previous || previous.move.id === move.id) ? null : previous,
    );
    setOpenSpecialMoves((previous) => ({ ...previous, [move.id]: true }));
  }

  /** Devolve o ponto gasto no desbloqueio (corrige erro de clique). */
  function refundSpecialMoveCard(move: SpecialMove) {
    const updated = refundSpecialMove(character, move);
    if (updated) onUpdate(updated);
    setSpecialMoveOutcome((previous) =>
      previous && !("error" in previous) && previous.move.id === move.id ? null : previous,
    );
  }

  /** Disponibilidade dos 9 moves para o estado atual (perícia, atributos e flags do turno). */
  const specialMoveAvailability = listSpecialMoveAvailability(character, turnState);
  const maPoints = getMartialArtsPoints(character);
  const allSpecialMovesOpen = specialMoveAvailability.every((entry) => openSpecialMoves[entry.move.id]);
  /** Ação disparada por botão no card de cyberware (ex.: Nano Repair → +2 HP). */
  function handleCyberwareAction(cyberwareId: string) {
    const outcome = runCyberwareAction(character, cyberwareId);
    if ("error" in outcome) {
      setCyberwareNotice(outcome.error);
      return;
    }
    setCyberwareNotice(`Nano Repair: +${outcome.healed} HP.`);
    onUpdate(outcome.character);
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
    const woundThreshold = calculateWoundThreshold(character.combat.hp.max);
    // Se o personagem está Seriously Wounded ou pior, restaura HP para acima do threshold
    const newHP = character.combat.hp.current <= woundThreshold
      ? Math.min(character.combat.hp.max, woundThreshold + 1)
      : character.combat.hp.current;
    onUpdate({
      ...character,
      combat: {
        ...character.combat,
        criticalInjuries: updated,
        hp: { ...character.combat.hp, current: newHP },
      },
    });
  }
  function handleFullHeal() {
    onUpdate({
      ...character,
      combat: {
        ...character.combat,
        hp: { ...character.combat.hp, current: character.combat.hp.max },
        criticalInjuries: [],
        deathSaveDC: 0,
        deathSaveFailures: 0,
        isDead: false,
      },
    });
    setLastDeathSave(null);
    setLastFirstAidRoll(null);
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
    setCombatError(""); setReceivedDamage(""); onUpdate(resolution.character);
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
      setLastFirstAidRoll(null);
      onUpdate(resolution.character);
      setTimeout(() => setFirstAidMessage(""), 3000);
    }
  }
  function handleRollFirstAid() {
    // Verifica se tem medkit no inventário
    const hasAdvancedMedkit = character.inventory.some((item) => item.catalogItemId === "advanced_medkit" && item.quantity > 0);
    const hasBasicMedkit = character.inventory.some((item) => item.catalogItemId === "basic_medkit" && item.quantity > 0);
    const medkitBonus = hasAdvancedMedkit ? 2 : 0;
    const medkitId = hasAdvancedMedkit ? "advanced_medkit" : "basic_medkit";

    if (!hasBasicMedkit && !hasAdvancedMedkit) {
      setCombatError("Nenhum medkit disponível no inventário.");
      return;
    }

    setRollingFirstAid(true);
    setLastFirstAidRoll(null);
    setCombatError("");

    const resolution = rollFirstAid(character, medkitBonus);
    if ("error" in resolution) {
      setCombatError(resolution.error);
      setRollingFirstAid(false);
      return;
    }

    // Consome 1 medkit do inventário
    const updatedInventory = character.inventory.map((item) =>
      item.catalogItemId === medkitId
        ? { ...item, quantity: item.quantity - 1 }
        : item
    ).filter((item) => item.quantity > 0);

    const characterWithMedkitUsed = {
      ...resolution.character,
      inventory: updatedInventory,
    };

    setLastFirstAidRoll(resolution.result);
    if (resolution.result.success) {
      setLastDeathSave(null);
    }
    onUpdate(characterWithMedkitUsed);
    setTimeout(() => setRollingFirstAid(false), 1500);
  }
  function sellItem(inventoryItemId: string) {
    const result = sellInventoryItem(character, inventoryItemId);
    if ("error" in result) { setCombatError("Não foi possível vender este item."); return; }
    setCombatError(""); onUpdate(result.character);
  }
  function equipItem(inventoryItemId: string) {
    const result = equipInventoryItem(character, inventoryItemId);
    if (!result) return;
    if ("error" in result) { setEquipError(result.error); return; }
    setEquipError("");
    onUpdate(result.character);
    setLastHumanityLoss(result.cyberwareInstallation?.humanityLoss ?? null);
  }
  function handleUseHealingItem(inventoryItemId: string) {
    const result = applyHealingItem(character, inventoryItemId);
    if ("error" in result) {
      setHealNotice({ text: result.error, isError: true });
      return;
    }
    setHealNotice({
      text: `${result.itemName} usado: ${result.restored > 0 ? `+${result.restored} HP` : "HP já está no máximo"}${result.stabilized ? " · Estabilizado" : ""}.`,
      isError: false,
    });
    onUpdate(result.character);
    setTimeout(() => setHealNotice(null), 3000);
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

  /** Card de perícia compartilhado pelas duas colunas.
   * `variant: "spec"` = especialização de Martial Arts (aninhada sob a mãe): custa pontos
   * gerados por `martial_arts`, não IP. */
  function skillCard(id: string, skill: Skill) {
    const base = getSkillBase(character, id);
    const cost = getSkillUpgradeCost(skill.level, skill.costMultiplier);
    const canUpgrade = canUpgradeSkill(character, id);
    const rollResult = lastSkillRoll?.skillId === id ? lastSkillRoll.result : null;
    const isMaxed = skill.level >= 10;
    const maPoints = id === "martial_arts" ? getMartialArtsPoints(character) : null;
    return (
      <div className={`skill-card ${isMaxed ? "maxed" : ""}`} key={id}>
        <div className="skill-card-main">
          <div className="skill-card-info">
            <span className="skill-name">{skill.name}</span>
            <div className="skill-meta">
              <span className="skill-stat">{skill.stat}</span>
              {skill.costMultiplier === 2 && <span className="skill-double-cost">×2</span>}
              {maPoints && (
                <span
                  className={`skill-ma-points${maPoints.free > 0 ? " has" : ""}${maPoints.balance < 0 ? " debt" : ""}`}
                  title={`1 ponto por nível de Martial Arts · ${maPoints.total} gerado(s) · ${maPoints.spentSpecializations} em especializações · ${maPoints.spentMoves} em Special Moves`}
                >
                  {maPoints.balance < 0
                    ? `devendo ${-maPoints.balance} pt`
                    : `${maPoints.free} ponto${maPoints.free === 1 ? "" : "s"} livre${maPoints.free === 1 ? "" : "s"}`}
                </span>
              )}
            </div>
          </div>
          <div className="skill-card-values">
            <div className="skill-level-display">
              <span className="skill-level-label">LV</span>
              <span className="skill-level-value">{skill.level}</span>
            </div>
            <div className="skill-base-display">
              <span className="skill-base-label">BASE</span>
              <span className="skill-base-value">{base}</span>
            </div>
          </div>
          <div className="skill-card-actions">
            {!isMaxed && (
              <button
                type="button"
                className="skill-upgrade-btn"
                disabled={!canUpgrade}
                onClick={() => improveSkill(id)}
                title={`Custo: ${cost} IP`}
              >
                ↑
              </button>
            )}
            <button
              type="button"
              className="skill-roll-btn"
              onClick={() => handleRollSkillCheck(character, id)}
              aria-label={`Rolar ${skill.name}`}
              disabled={rollingSkill?.id === id}
            >
              {rollingSkill?.id === id ? (
                <span className="rolling-indicator">🎲</span>
              ) : (
                "🎲"
              )}
            </button>
          </div>
        </div>
        {!isMaxed && (
          <div className="skill-upgrade-info">
            <span className="upgrade-cost">{cost} IP</span>
          </div>
        )}
        {rollResult && (
          <div className="skill-roll-result-card">
            <div className="roll-result-header">
              {rollResult.critical && <span className="crit-badge">⚡ CRÍTICO</span>}
              {rollResult.fumble && <span className="fumble-badge">💥 FALHA CRÍTICA</span>}
              {!rollResult.critical && !rollResult.fumble && (
                <span className="roll-total-value">{rollResult.total}</span>
              )}
            </div>
            <div className="roll-result-breakdown">
              <span className="roll-formula">
                {rollResult.statId} {rollResult.statBase} + {rollResult.skillName} {rollResult.skillLevel} + 1d10
              </span>
              <div className="roll-dice-row">
                {rollResult.diceRolls.map((r, idx) => (
                  <span
                    key={idx}
                    className={`roll-die ${r.type === 'crit' || r.type === 'crit_add' ? 'crit' : ''} ${r.type === 'fumble' || r.type === 'fumble_sub' ? 'fumble' : ''}`}
                  >
                    {r.type === 'crit_add' && '+'}{r.type === 'fumble_sub' && '−'}[{r.value}]
                  </span>
                ))}
                <span className="dice-subtotal">= {rollResult.diceRoll}</span>
              </div>
              {rollResult.totalModifier !== 0 && (
                <span className="roll-modifier">
                  Mod: {rollResult.totalModifier >= 0 ? '+' : ''}{rollResult.totalModifier}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <main className="sheet-shell">
      <nav className={`sheet-nav${navDrawerOpen ? " is-open" : ""}`}>
        <span>CYBERPUNK RED TOOLKIT</span>
        <div
          className="sheet-nav-links"
          onClick={(event) => {
            // No mobile este div vira a gaveta lateral: tocar em qualquer ação
            // fecha o menu (🎲 Dados também dispara a abertura da gaveta de dados).
            if ((event.target as HTMLElement).closest("button, a")) {
              setNavDrawerOpen(false);
            }
          }}
        >
          <button onClick={() => setDiceDrawerOpen(true)}>🎲 Dados</button>
          <MesaEntry />
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
        <button
          type="button"
          className="nav-hamburger"
          aria-label={navDrawerOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={navDrawerOpen}
          onClick={() => setNavDrawerOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>
      </nav>
      <div
        className={`nav-drawer-backdrop${navDrawerOpen ? " is-open" : ""}`}
        onClick={() => setNavDrawerOpen(false)}
        aria-hidden="true"
      />
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
                  <strong>
                    {character.stats[stat] + (stat === "MOVE" ? cyberwareMoveBonus : 0)}
                    {stat === "MOVE" && cyberwareMoveBonus !== 0 && (
                      <em className="stat-cyberware-bonus">
                        {cyberwareMoveBonus > 0 ? `+${cyberwareMoveBonus}` : cyberwareMoveBonus}
                      </em>
                    )}
                  </strong>
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
                        {(() => {
                          const hasAdvancedMedkit = character.inventory.some((item) => item.catalogItemId === "advanced_medkit" && item.quantity > 0);
                          const hasBasicMedkit = character.inventory.some((item) => item.catalogItemId === "basic_medkit" && item.quantity > 0);
                          const hasMedkit = hasBasicMedkit || hasAdvancedMedkit;
                          return (
                            <>
                              {hasMedkit && (
                                <button
                                  type="button"
                                  className="first-aid-btn"
                                  onClick={handleRollFirstAid}
                                  disabled={rollingFirstAid || character.combat.isDead}
                                >
                                  {rollingFirstAid
                                    ? "🎲 Rollando..."
                                    : `🩹 First Aid (1d10 + TECH + First Aid${hasAdvancedMedkit ? " + 2" : ""} vs DV 15)`}
                                </button>
                              )}
                              <button
                                type="button"
                                className="first-aid-btn first-aid-btn-secondary"
                                onClick={handleFirstAid}
                                title="Aplicar sem rolagem (outro jogador usa medkit)"
                              >
                                🩹 First Aid (→ 1 HP)
                              </button>
                            </>
                          );
                        })()}
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
                      {lastFirstAidRoll && (
                        <div className={`death-save-result ${lastFirstAidRoll.success ? "death-save-success" : "death-save-fail"}`}>
                          <span>
                            {lastFirstAidRoll.success ? "✓ Sucesso!" : "✗ Falha!"}{" "}
                            1d10 [{lastFirstAidRoll.diceRoll}] + TECH {lastFirstAidRoll.techValue} + First Aid {lastFirstAidRoll.firstAidLevel}{lastFirstAidRoll.medkitBonus > 0 ? ` + Medkit ${lastFirstAidRoll.medkitBonus}` : ""}{lastFirstAidRoll.injuryModifier !== 0 ? ` + Lesão ${lastFirstAidRoll.injuryModifier}` : ""} = {lastFirstAidRoll.total} vs DV {lastFirstAidRoll.dv}
                          </span>
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
                    <span className="initiative-formula">
                      REF {character.stats.REF}
                      {initiativeModifiers
                        .map((modifier) => ` ${modifier.value >= 0 ? "+" : ""}${modifier.value} ${modifier.source}`)
                        .join("")}{" "}
                      + 1d10
                    </span>
                  </div>
                  <button
                    type="button"
                    className="initiative-roll-btn"
                    onClick={() => rollInitiative()}
                    disabled={rollingInitiative !== null}
                  >
                    {rollingInitiative !== null ? (
                      <span className="rolling-indicator">🎲 {rollingInitiative}</span>
                    ) : (
                      "🎲 Rolar"
                    )}
                  </button>
                  {initiativeRerollCyberware && (
                    <button
                      type="button"
                      className="initiative-reroll-btn"
                      title="Reflex Tuner: repetir Iniciativa e desligar a peça"
                      onClick={() => rollInitiative(initiativeRerollCyberware.cyberwareId)}
                      disabled={rollingInitiative !== null}
                    >
                      ↻ Repetir
                    </button>
                  )}
                </div>
                {lastInitiative && (
                  <div className="initiative-result" role="status">
                    <div className="initiative-result-header">
                      {lastInitiative.critical && <span className="crit-badge">⚡ CRÍTICO</span>}
                      {lastInitiative.fumble && <span className="fumble-badge">💥 FALHA CRÍTICA</span>}
                    </div>
                    <span className="initiative-result-formula">
                      {lastInitiative.expression}
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
                // Alimenta os requisitos dos Special Moves com o ataque que acabou de ser rolado.
                setTurnState((previous) => {
                  if (result.attackType === "martial_arts") return { ...previous, hitMartialArts: true };
                  if (result.attackType === "brawling") return { ...previous, hitBrawling: true };
                  if (result.attackType === "melee") return { ...previous, meleeHits: previous.meleeHits + 1 };
                  return previous;
                });
              }}
              weaponAttackModes={weaponAttackModes}
              onAttackModeChange={(weaponId, mode) => setWeaponAttackModes((prev) => ({ ...prev, [weaponId]: mode }))}
            />
            {(lastAttack ?? character.lastAttack) &&
              (() => {
                const attack = lastAttack ?? character.lastAttack!;
                return (
                  <div className="attack-result-card" role="status">
                    {/* Attack Header */}
                    <div className="attack-result-header">
                      <div className="attack-weapon-info">
                        <span className="attack-weapon-name">{attack.label}</span>
                        {attack.attackType && (
                          <span className={`attack-type-badge type-${attack.attackType}`}>
                            {attack.attackType}
                          </span>
                        )}
                      </div>
                      <div className={`attack-total-display ${attack.critical ? 'critical' : ''} ${attack.fumble ? 'fumble' : ''}`}>
                        {attack.total}
                      </div>
                    </div>

                    {/* Badges */}
                    {(attack.critical || attack.fumble) && (
                      <div className="attack-badges">
                        {attack.critical && <span className="crit-badge">⚡ CRÍTICO</span>}
                        {attack.fumble && <span className="fumble-badge">💥 FALHA CRÍTICA</span>}
                      </div>
                    )}

                    {/* Roll Breakdown */}
                    <div className="attack-breakdown">
                      <div className="attack-formula">
                        <span className="formula-stat">{attack.stat.id} {attack.stat.value}</span>
                        <span className="formula-plus">+</span>
                        <span className="formula-skill">{attack.skill.id} {attack.skill.value}</span>
                        <span className="formula-plus">+</span>
                        <span className="formula-dice">1d10</span>
                      </div>

                      {/* Dice Results */}
                      <div className="attack-dice-row">
                        {attack.diceRolls?.map((r: any, idx: number) => (
                          <span
                            key={idx}
                            className={`attack-die ${r.type === 'crit' || r.type === 'crit_add' ? 'crit' : ''} ${r.type === 'fumble' || r.type === 'fumble_sub' ? 'fumble' : ''}`}
                          >
                            {r.type === 'crit_add' && '+'}{r.type === 'fumble_sub' && '−'}[{r.value}]
                          </span>
                        ))}
                        <span className="dice-subtotal">= {attack.diceTotal}</span>
                      </div>

                      {/* Modifiers */}
                      {attack.modifiers.length > 0 && (
                        <div className="attack-modifiers">
                          {attack.modifiers.map((modifier, idx) => (
                            <span key={idx} className="modifier-tag">
                              {modifier.source} {modifier.value >= 0 ? '+' : ''}{modifier.value}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Damage Section */}
                    {attack.damageDice && (
                      <div className="attack-damage-section">
                        <button
                          type="button"
                          className="roll-damage-btn"
                          onClick={rollDamage}
                        >
                          🎲 Rolar Dano ({attack.damageDice})
                        </button>
                        {attack.damageSources && attack.damageSources.length > 0 && (
                          <p className="damage-breakdown">{attack.damageSources.join(" · ")}</p>
                        )}
                        {attack.attackType === "martial_arts" && (
                          <p className="martial-arts-sp-note">
                            ⚔ Artes Marciais: ignora metade do SP da armadura, arredondando para cima (SP 11 → 6).
                          </p>
                        )}

                        {/* Damage Result */}
                        {lastDamage && lastDamage.attackId === attack.attackId && (
                          <div className="damage-result-card">
                            <div className="damage-result-header">
                              <span className="damage-label">Dano ({lastDamage.damageDice})</span>
                              <span className="damage-total">{lastDamage.total}</span>
                            </div>
                            <div className="damage-dice-row">
                              {lastDamage.roll.rolls.map((roll, idx) => (
                                <span key={idx} className={`damage-die ${roll === 6 ? 'max' : ''}`}>
                                  [{roll}]
                                </span>
                              ))}
                            </div>
                            {(() => {
                              const sixCount = lastDamage.roll.rolls.filter((r) => r === 6).length;
                              if (sixCount >= 2) {
                                return (
                                  <div className="critical-injury-warning">
                                    ⚠ CRITICAL INJURY! {sixCount} resultados 6 no dano.
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            <div className="ma-specializations">
              <div className="special-move-section-head">
                <h3>Especializações de Artes Marciais</h3>
                <span className="ma-points-badge">{maPoints.free} pt livre{maPoints.free === 1 ? "" : "s"}</span>
              </div>
              <p className={`ma-points-line${maPoints.balance < 0 ? " warn" : ""}`}>
                MA {maPoints.total} → {maPoints.total} pt · {maPoints.spentSpecializations} espec · {maPoints.spentMoves} moves · {maPoints.free} livre
                {maPoints.balance < 0 ? ` · devendo ${-maPoints.balance}` : ""}
              </p>
              {MARTIAL_ARTS_FORMS.map(({ skillId }) => {
                const skill = character.skills[skillId];
                const cost = getSpecializationCost(skill.level);
                const canUp = canUpgradeSpecialization(character, skillId);
                const canDown = skill.level > 0;
                return (
                  <div className="ma-spec-card" key={skillId}>
                    <div className="ma-spec-info">
                      <span className="ma-spec-name">{skill.name}</span>
                      <span className="ma-spec-level">NV {skill.level}</span>
                    </div>
                    <div className="ma-spec-actions">
                      <button type="button" className="ma-spec-btn up" disabled={!canUp} onClick={() => upgradeSpec(skillId)} title={`Custo: ${cost} ponto${cost === 1 ? "" : "s"} de Martial Arts`}>↑</button>
                      <button type="button" className="ma-spec-btn down" disabled={!canDown} onClick={() => downgradeSpec(skillId)}>↓</button>
                    </div>
                    <span className="ma-spec-cost">{cost}pt</span>
                  </div>
                );
              })}
            </div>
            <div className="special-move-section-head">
              <h3>Especialidades de Artes Marciais</h3>
              <button
                type="button"
                className="smc-toggle-all"
                onClick={() =>
                  setOpenSpecialMoves(
                    Object.fromEntries(specialMoveAvailability.map((entry) => [entry.move.id, !allSpecialMovesOpen])),
                  )
                }
              >
                {allSpecialMovesOpen ? "Recolher tudo" : "Expandir tudo"}
              </button>
            </div>
            <div className="turn-state-panel">
              <div className="turn-state-header">
                <span className="turn-state-title">Estado do turno</span>
                <button
                  type="button"
                  className="turn-state-reset"
                  onClick={() => {
                    setTurnState(DEFAULT_TURN_STATE);
                    setSpecialMoveOutcome(null);
                  }}
                >
                  ↻ Zerar turno
                </button>
              </div>
              <div className="turn-state-grid">
                <label className="turn-state-field">
                  <span>Movido (m)</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={turnState.movedMeters}
                    onChange={(event) => setTurnState((previous) => ({ ...previous, movedMeters: Math.max(0, Number(event.target.value) || 0) }))}
                  />
                </label>
                <label className="turn-state-field">
                  <span>Melee Hits</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={turnState.meleeHits}
                    onChange={(event) => setTurnState((previous) => ({ ...previous, meleeHits: Math.max(0, Number(event.target.value) || 0) }))}
                  />
                </label>
                <label className="turn-state-chip">
                  <input type="checkbox" checked={turnState.hitBrawling} onChange={(event) => setTurnState((previous) => ({ ...previous, hitBrawling: event.target.checked }))} />
                  <span>Acertei Brawling</span>
                </label>
                <label className="turn-state-chip">
                  <input type="checkbox" checked={turnState.hitMartialArts} onChange={(event) => setTurnState((previous) => ({ ...previous, hitMartialArts: event.target.checked }))} />
                  <span>Acertei Martial Arts</span>
                </label>
                <label className="turn-state-chip">
                  <input type="checkbox" checked={turnState.grabbingTarget} onChange={(event) => setTurnState((previous) => ({ ...previous, grabbingTarget: event.target.checked }))} />
                  <span>Agarrando o alvo</span>
                </label>
                <label className="turn-state-chip">
                  <input type="checkbox" checked={turnState.dodgedAllMelee} onChange={(event) => setTurnState((previous) => ({ ...previous, dodgedAllMelee: event.target.checked }))} />
                  <span>Esquivei de todos os melee</span>
                </label>
              </div>
              <p className="turn-state-note">
                O app não conta rodadas: marque ao começar o turno e limpe com ↻. Rolar um ataque já marca o &quot;Acertei …&quot; correspondente — desmarque se ele não acertou.
              </p>
            </div>

            {specialMoveOutcome && "error" in specialMoveOutcome && <p className="form-error">{specialMoveOutcome.error}</p>}

            {specialMoveAvailability.map(({ move, skill, available, missing, points, unlocked, canUnlock }) => {
              const outcome =
                specialMoveOutcome && !("error" in specialMoveOutcome) && specialMoveOutcome.move.id === move.id
                  ? specialMoveOutcome
                  : null;
              const open = Boolean(openSpecialMoves[move.id]);
              const outcomeIcon =
                outcome && outcome.kind === "check" ? (outcome.success ? "✓" : "✗") : outcome ? "⚔" : null;
              const outcomeClass = outcome
                ? outcome.kind === "check" && !outcome.success
                  ? "fail"
                  : "ok"
                : "";
              // Travado = sem ponto; unlockable = tem ponto e ainda não pagou.
              let cardState = "";
              if (!available) cardState = canUnlock ? " unlockable" : " locked";
              return (
                <div className={`special-move-card${cardState}${open ? " open" : ""}`} key={move.id}>
                  <button
                    type="button"
                    className="smc-header"
                    aria-expanded={open}
                    aria-controls={`smc-body-${move.id}`}
                    onClick={() => toggleSpecialMove(move.id)}
                  >
                    <span className="smc-header-top">
                      <span className="smc-form">
                        {move.form === "shared" ? "Comum" : move.form.charAt(0).toUpperCase() + move.form.slice(1)}
                      </span>
                      <span className="smc-name">{move.name}</span>
                      <span className="smc-chevron" aria-hidden="true">
                        ▾
                      </span>
                    </span>
                    <span className="smc-header-meta">
                      {skill && (
                        <span className="smc-skill-tag" title={`${skill.name} ${skill.level}`}>
                          Nv {skill.level}
                        </span>
                      )}
                      {outcomeIcon && <span className={`smc-result ${outcomeClass}`}>{outcomeIcon}</span>}
                      <span className={`smc-badge ${!unlocked ? (canUnlock ? "unlockable" : "locked") : available ? "ok" : "blocked"}`}>
                        {!unlocked ? (canUnlock ? "Liberável" : "Travado") : available ? "Disponível" : "Bloqueado"}
                      </span>
                    </span>
                  </button>
                  {open && (
                    <div className="smc-body" id={`smc-body-${move.id}`} role="status">
                      <p className="smc-requirement">
                        <strong>Requisito:</strong> {move.requirement}
                      </p>
                      <p className="smc-effect">{move.effect}</p>
                      {skill && (
                        <p className="smc-skill">
                          Perícia usada: {skill.name} {skill.level} — o nível vem só dessa forma, sem somar com as outras.
                        </p>
                      )}
                      <p className={`smc-pool${unlocked ? " unlocked" : ""}`}>
                        {unlocked
                          ? `✓ Desbloqueado — 1 ponto de Martial Arts gasto (${points.spentSpecializations + points.spentMoves}/${points.total})`
                          : `Desbloqueio: 1 ponto de Martial Arts — nível ${points.total} = ${points.total} ponto${points.total === 1 ? "" : "s"} · ${points.spentSpecializations} em especializações · ${points.spentMoves} em moves · ${points.free} livre${points.free === 1 ? "" : "s"}`}
                      </p>
                      {points.balance < 0 && (
                        <p className="smc-pool warn">
                          Especializações já pagas custaram {Math.abs(points.balance)} ponto
                          {Math.abs(points.balance) === 1 ? "" : "s"} a mais do que o nível atual de Martial Arts cobre —
                          suba a perícia-mãe para liberar gastos.
                        </p>
                      )}
                      {!available && missing.length > 0 && (
                        <ul className="smc-missing">
                          {missing.map((reason) => (
                            <li key={reason}>✗ {reason}</li>
                          ))}
                        </ul>
                      )}
                      {move.headAim && available && (
                        <label className="turn-state-chip">
                          <input
                            type="checkbox"
                            checked={Boolean(specialMoveHeadAim[move.id])}
                            onChange={(event) =>
                              setSpecialMoveHeadAim((previous) => ({ ...previous, [move.id]: event.target.checked }))
                            }
                          />
                          <span>Mira na cabeça (−8)</span>
                        </label>
                      )}
                      {!unlocked && (
                        <button
                          type="button"
                          className="smc-unlock"
                          disabled={!canUnlock}
                          onClick={() => unlockSpecialMoveCard(move)}
                        >
                          {canUnlock
                            ? "🔓 Desbloquear — 1 ponto de Martial Arts"
                            : skill
                              ? `Sem ponto livre de Martial Arts (${points.free}/${points.total})`
                              : `Sem ponto em ${move.form === "shared" ? "Martial Arts" : `${move.form.charAt(0).toUpperCase() + move.form.slice(1)}`}`}
                        </button>
                      )}
                      {unlocked && move.kind !== "passive" && (
                        <button type="button" className="smc-use" disabled={!available} onClick={() => useSpecialMove(move)}>
                          {available ? "Usar" : "Indisponível"}
                        </button>
                      )}
                      {available && move.kind === "passive" && (
                        <div className="smc-outcome info">✓ {move.outcome}</div>
                      )}
                      {outcome && outcome.kind === "check" && (
                        <div className={`smc-outcome ${outcome.success ? "success" : "failure"}`}>
                          <strong>{outcome.success ? "✓ SUCESSO" : "✗ FALHA"}</strong> — {outcome.total} vs DV {outcome.dv}
                          {outcome.success && move.outcome ? <span> · {move.outcome}</span> : null}
                        </div>
                      )}
                      {outcome && outcome.kind === "attack" && (
                        <div className="smc-outcome info">
                          ✓ Ataque rolado: {outcome.attack.total}. Role o dano no cartão de ataque acima —{" "}
                          {move.outcome}
                        </div>
                      )}
                      {outcome && outcome.kind === "passive" && <div className="smc-outcome info">{move.outcome}</div>}
                      {unlocked && (
                        <button type="button" className="smc-refund" onClick={() => refundSpecialMoveCard(move)}>
                          ↺ Devolver o ponto
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
              <>
                <div className="injury-actions-bar">
                  <button type="button" className="full-heal-btn" onClick={handleFullHeal}>
                    ✚ Full Heal (HP Máx + Limpar tudo)
                  </button>
                </div>
                {character.combat.criticalInjuries.map((injury, idx) => (
                  <div className="critical-injury-card" key={idx} role="status">
                    <div className="cic-top">
                      <div className="cic-badge">{hitLocationLabels[injury.location]}</div>
                      <span className="cic-name">{injury.name}</span>
                      <button type="button" className="cic-curar-btn" onClick={() => removeCriticalInjury(idx)}>
                        ✕ Curar
                      </button>
                    </div>
                    {injury.effect && (
                      <div className="cic-row">
                        <span className="cic-label">Efeito</span>
                        <span className="cic-value">{injury.effect}</span>
                      </div>
                    )}
                    <div className="cic-details">
                      {injury.quickFix && (
                        <div className="cic-detail">
                          <span className="cic-detail-label">Quick Fix</span>
                          <span className="cic-detail-value">{injury.quickFix}</span>
                        </div>
                      )}
                      {injury.treatment && (
                        <div className="cic-detail">
                          <span className="cic-detail-label">Treatment</span>
                          <span className="cic-detail-value">{injury.treatment}</span>
                        </div>
                      )}
                      <div className="cic-detail">
                        <span className="cic-detail-label">Bonus Dano</span>
                        <span className="cic-detail-value">{injury.bonusDamage}</span>
                      </div>
                      {injury.deathSavePenalty !== undefined && (
                        <div className="cic-detail cic-detail-danger">
                          <span className="cic-detail-label">Death Save</span>
                          <span className="cic-detail-value">{injury.deathSavePenalty}</span>
                        </div>
                      )}
                    </div>
                    {injury.modifiers && injury.modifiers.length > 0 && (
                      <div className="cic-modifiers">
                        {injury.modifiers.map((mod, mi) => (
                          <span key={mi} className="cic-modifier-tag">{mod.description}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <EmptyState>Nenhuma lesão crítica.</EmptyState>
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
          <div className="skills-balanced-grid">
            <div className="skills-column">
            {col1.map(([category, skills]) => (
              <div className="skill-category-card" key={category}>
                <div className="skill-category-header">
                  <h3>{categoryNames[category]}</h3>
                  <span className="skill-count">{skills.length}</span>
                </div>
                <div className="skill-list">
                  {skills.map(([id, skill]) => skillCard(id, skill))}
                </div>
              </div>
            ))}
            </div>
            <div className="skills-column">
            {col2.map(([category, skills]) => (
              <div className="skill-category-card" key={category}>
                <div className="skill-category-header">
                  <h3>{categoryNames[category]}</h3>
                  <span className="skill-count">{skills.length}</span>
                </div>
                <div className="skill-list">
                  {skills.map(([id, skill]) => skillCard(id, skill))}
                </div>
              </div>
            ))}
            </div>
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
              <div className="quickhacks-grid">
                {availableQuickhacks.map((quickhack) => (
                  <div
                    key={quickhack.id}
                    className={`quickhack-card ${expandedQuickhack === quickhack.id ? 'expanded' : ''}`}
                    onClick={() => setExpandedQuickhack(expandedQuickhack === quickhack.id ? null : quickhack.id)}
                  >
                    <div className="quickhack-card-header">
                      <div className="quickhack-card-title">
                        <span className="quickhack-name">{quickhack.name}</span>
                        <span className={`quickhack-category-badge badge-${quickhack.category.toLowerCase()}`}>
                          {quickhack.category}
                        </span>
                      </div>
                      <div className="quickhack-card-meta">
                        <span className="quickhack-dv">DV {quickhack.dv}</span>
                        <button
                          type="button"
                          className="quickhack-roll-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRollQuickhack(quickhack.id);
                          }}
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
                    </div>
                    {expandedQuickhack === quickhack.id && (
                      <div className="quickhack-card-details">
                        <div className="quickhack-detail-row">
                          <span className="quickhack-detail-label">Alvo:</span>
                          <span className="quickhack-detail-value">{quickhack.target}</span>
                        </div>
                        <div className="quickhack-detail-row">
                          <span className="quickhack-detail-label">Duração:</span>
                          <span className="quickhack-detail-value">{quickhack.duration}</span>
                        </div>
                        <div className="quickhack-detail-row">
                          <span className="quickhack-detail-label">Teste:</span>
                          <span className="quickhack-detail-value">{quickhack.test}</span>
                        </div>
                        <div className="quickhack-detail-row">
                          <span className="quickhack-detail-label">Efeito:</span>
                          <span className="quickhack-detail-value effect">{quickhack.effect}</span>
                        </div>
                        {quickhack.notes && (
                          <div className="quickhack-detail-row">
                            <span className="quickhack-detail-label">Notas:</span>
                            <span className="quickhack-detail-value notes">{quickhack.notes}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {lastQuickhack && lastQuickhack.quickhackId === quickhack.id && (
                      <div className="quickhack-result-inline">
                        <span className="quickhack-roll-breakdown">
                          {lastQuickhack.success ? "✓" : "✗"} Interface {lastQuickhack.skill.value} + {lastQuickhack.roll.expression}: {lastQuickhack.roll.rolls
                            .map((roll) => `[${roll}]`)
                            .join(" ")} = {lastQuickhack.roll.total}
                        </span>
                        <span className="quickhack-total">Total: <b>{lastQuickhack.total}</b> vs DV {quickhack.dv}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
          )}
          </section>
        )}
      <StorePanel character={character} onUpdate={onUpdate} />
      <section className="equipment-layout">
        <section className="sheet-panel weapons-panel">
          <PanelTitle number="05">Armas</PanelTitle>
          {character.weapons.length ? (
            <div className="weapons-grid">
              {character.weapons.map((weapon) => (
                <div key={weapon.id} className="weapon-card">
                  <div className="weapon-card-header">
                    <div className="weapon-card-title">
                      <h3>{weapon.name}</h3>
                      <span className="weapon-skill-badge">
                        {weapon.skill || "Sem perícia"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="weapon-remove-btn"
                      onClick={() => onUpdate({ ...character, weapons: character.weapons.filter((w) => w.id !== weapon.id) })}
                      aria-label={`Remover ${weapon.name}`}
                    >
                      ×
                    </button>
                  </div>
                  <div className="weapon-card-stats">
                    <div className="weapon-stat">
                      <span className="weapon-stat-label">Dano</span>
                      <span className="weapon-stat-value">{weapon.damage}</span>
                    </div>
                    {weapon.rateOfFire && (
                      <div className="weapon-stat">
                        <span className="weapon-stat-label">ROF</span>
                        <span className="weapon-stat-value">{weapon.rateOfFire}</span>
                      </div>
                    )}
                    {weapon.magazine !== undefined && (
                      <div className="weapon-stat">
                        <span className="weapon-stat-label">Munição</span>
                        <span className={`weapon-stat-value ${(weapon.ammo ?? 0) <= 0 ? 'empty' : ''}`}>
                          {weapon.ammo ?? 0}/{weapon.magazine}
                        </span>
                      </div>
                    )}
                  </div>
                  {weapon.magazine !== undefined && (
                    <div className="weapon-card-actions">
                      <button
                        type="button"
                        className="weapon-reload-btn"
                        onClick={() => handleReload(weapon.id)}
                        disabled={(weapon.ammo ?? 0) >= weapon.magazine}
                      >
                        ↻ Recarregar
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {reloadError && <p className="form-error">{reloadError}</p>}
            </div>
          ) : (
            <EmptyState>Nenhuma arma equipada.</EmptyState>
          )}
        </section>

        <section className="sheet-panel cyberware-panel">
          <PanelTitle number="06">Cyberware</PanelTitle>
          {character.cyberware.length ? (
            <div className="cyberware-grid">
              {character.cyberware.map((item) => {
                const control = installedCyberwareEffects.find((entry) => entry.cyberwareId === item.id);
                const effects = control?.effects ?? [];
                return (
                <div key={item.id} className="cyberware-card">
                  <div className="cyberware-card-header">
                    <div className="cyberware-card-title">
                      <h3>{item.name}</h3>
                      {item.isBorgware && (
                        <span className="cyberware-borgware-badge">Borgware</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="cyberware-remove-btn"
                      onClick={() => onUpdate(removeCyberware(character, item.id))}
                      aria-label={`Remover ${item.name}`}
                    >
                      ×
                    </button>
                  </div>
                  <div className="cyberware-card-details">
                    <span className="cyberware-humanity-loss">
                      {item.humanityLoss
                        ? `Perda: ${item.humanityLoss}`
                        : "Sem perda"}
                    </span>
                  </div>
                  {effects.length > 0 && (
                    <ul className="cyberware-effects">
                      {effects.map((effect) => (
                        <li key={effect}>{effect}</li>
                      ))}
                    </ul>
                  )}
                  {control?.activation && (
                    <div className="cyberware-card-controls">
                      <button
                        type="button"
                        className={`cyberware-toggle${control.activation.activeStage !== undefined ? " is-active" : ""}`}
                        aria-pressed={control.activation.activeStage !== undefined}
                        onClick={() => {
                          setCyberwareNotice("");
                          onUpdate(toggleCyberwareActivation(character, item.id));
                        }}
                      >
                        {control.activation.activeStage !== undefined
                          ? `● ${control.activation.label}: ${control.activation.stages[control.activation.activeStage]}`
                          : `○ ${control.activation.label}: inativo`}
                      </button>
                      {control.action?.type === "heal" && (
                        <button
                          type="button"
                          className="cyberware-action-btn"
                          disabled={!control.actionEnabled}
                          onClick={() => handleCyberwareAction(item.id)}
                        >
                          {control.action.label}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          ) : (
            <EmptyState>Nenhum cyberware instalado.</EmptyState>
          )}
          {cyberwareNotice && (
            <p className="cyberware-notice" role="status">{cyberwareNotice}</p>
          )}
        </section>

        <section className="sheet-panel inventory-panel">
          <PanelTitle number="07">Inventário</PanelTitle>
          {character.inventory.length ? (
            <div className="inventory-grid">
              {character.inventory.map((item) => {
                const catalogItem = item.catalogItemId ? getCatalogItem(item.catalogItemId) : null;
                const healAmount = isHealingItem(item) ? getItemHealAmount(item) : null;
                return (
                  <div key={item.id} className="inventory-card">
                    <div className="inventory-card-header">
                      <div className="inventory-card-title">
                        <span className="inventory-quantity">{item.quantity}×</span>
                        <span className="inventory-name">{item.name}</span>
                      </div>
                      <div className="inventory-card-actions">
                        {healAmount !== null && (
                          <button
                            type="button"
                            className="inventory-action-btn use"
                            onClick={() => handleUseHealingItem(item.id)}
                            disabled={character.combat.isDead || character.combat.hp.current >= character.combat.hp.max}
                            title={`Restaura ${healAmount} HP`}
                          >
                            ✚ Usar (+{healAmount} HP)
                          </button>
                        )}
                        {item.catalogItemId && (
                          <button
                            type="button"
                            className="inventory-action-btn sell"
                            onClick={() => sellItem(item.id)}
                          >
                            Vender
                          </button>
                        )}
                        {isEquippableItem(item) && (
                          <button
                            type="button"
                            className="inventory-action-btn equip"
                            onClick={() => equipItem(item.id)}
                          >
                            {item.category === "cyberware" ? "Instalar" : "Equipar"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="inventory-action-btn remove"
                          onClick={() => onUpdate({ ...character, inventory: character.inventory.filter((i) => i.id !== item.id) })}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    {catalogItem && (
                      <div className="inventory-card-prices">
                        <span className="inventory-price buy">
                          Compra: €$ {catalogItem.price.toLocaleString("pt-BR")}
                        </span>
                        <span className="inventory-price sell">
                          Venda: €$ {getSellPrice(catalogItem.price).toLocaleString("pt-BR")}/un.
                        </span>
                      </div>
                    )}
                    {item.notes && (
                      <div className="inventory-card-notes">{item.notes}</div>
                    )}
                    {item.category === "cyberware" && catalogItem?.effects && catalogItem.effects.length > 0 && (
                      <ul className="cyberware-effects">
                        {catalogItem.effects.map((effect) => (
                          <li key={effect}>{effect}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState>Inventário vazio.</EmptyState>
          )}
          {healNotice && (
            <p className={healNotice.isError ? "inventory-heal-notice error" : "inventory-heal-notice"}>
              {healNotice.text}
            </p>
          )}
          {equipError && (
            <p className="inventory-heal-notice error" role="alert">
              {equipError}
            </p>
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
      discordConsent={discordConsent}
      onDiscordConsentChange={onDiscordConsentChange}
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