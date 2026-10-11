import { getSkillBase, getCriticalInjuryModifiers, getCriticalInjuryRestrictions, getWoundPenalty } from "@/lib/calculations";
import { rollDice } from "@/lib/dice";
import type { RandomSource } from "@/lib/combat/contract";
import { getCatalogItem } from "@/data/items";
import { MARTIAL_ARTS_FORMS } from "@/data/skills";
import { findAmmoIndexByNames, getAmmoKind } from "@/data/enemySupplies";
import { getCyberwareAttackModifiers, getCyberwareEvasionModifiers, getCyberwarePhysicalModifiers, getCyberwareUnarmedDamageModifiers, hasInstalledCyberarm, isSmartWeapon } from "@/lib/cyberwareEffects";
import { createId } from "@/lib/id";
import type {
  AttackContext,
  AttackRollResult,
  AttackType,
  AvailableAttack,
  AttackModifier,
} from "@/types/attack";
import type { Character, RollHistoryEntry } from "@/types/character";

/** ROF dos ataques por perícia: Brawling e Martial Arts atacam com ROF 2. */
const UNARMED_ROF = 2;

/** Descobre ataques a partir de armas E de perícias, sem depender da UI. */
export function getAvailableAttacks(character: Character): AvailableAttack[] {
  const weaponAttacks: AvailableAttack[] = character.weapons
    .filter((weapon) => weapon.attackType && weapon.skill)
    .map((weapon) => ({
      id: `weapon:${weapon.id}`,
      label: weapon.name,
      detail: `${weapon.skill} + 1d10`,
      source: "weapon",
      context: { type: "weapon", weaponId: weapon.id },
    }));

  // Artes Marciais: a perícia-mãe legada continua disponível, e cada forma
  // especializada comprada pelo personagem também vira um ataque desarmado
  // próprio. O servidor valida o skillId no snapshot autoritativo.
  const martialArts = character.skills.martial_arts;
  const martialArtsSkills = [
    ...(martialArts && martialArts.level > 0 ? [{ skillId: "martial_arts", skill: martialArts }] : []),
    ...MARTIAL_ARTS_FORMS.flatMap(({ skillId }) => {
      const skill = character.skills[skillId];
      return skill && skill.level > 0 ? [{ skillId, skill }] : [];
    }),
  ];
  const skillAttacks: AvailableAttack[] = martialArtsSkills.map(({ skillId, skill }) => ({
    id: `skill:${skillId}`,
    label: skill.name,
    detail: `${skill.stat} + ${skill.name} + 1d10 · ROF ${UNARMED_ROF}`,
    source: "skill",
    rof: UNARMED_ROF,
    context: { type: "martial_arts", skillId },
  }));
  const brawling = character.skills.brawling;
  const brawlingAttack: AvailableAttack[] =
    brawling && brawling.level > 0
      ? [{ id: "skill:brawling", label: brawling.name, detail: `${brawling.stat} + ${brawling.name} + 1d10 · ROF ${UNARMED_ROF}`, source: "skill", rof: UNARMED_ROF, context: { type: "brawling", skillId: "brawling" } }]
      : [];
  return [...weaponAttacks, ...skillAttacks, ...brawlingAttack];
}

function getAttackLabel(type: AttackContext["type"]): string {
  return type === "martial_arts"
    ? "Artes Marciais"
    : type === "brawling" ? "Brawling"
    : type === "unarmed"
      ? "Ataque Desarmado"
      : "Ataque";
}

/** Tipos resolvidos que atacam à distância (penalidade de lesão à distância e Attack Modes). */
const RANGED_ATTACK_TYPES: AttackType[] = ["handgun", "smg", "rifle", "shotgun", "sniper", "heavy_weapon", "thrown_weapon", "grenade", "exotic_weapon"];
/** Tipos resolvidos de corpo a corpo. */
const MELEE_ATTACK_TYPES: AttackType[] = ["melee", "martial_arts", "brawling", "unarmed"];
/** Fallback legado: fichas antigas guardam `attackType: "weapon"` e o tipo fica na perícia. */
const RANGED_SKILL_IDS = ["archery", "autofire", "handgun", "heavy_weapons", "shoulder_arms"];

/**
 * O ataque é à distância?
 *
 * Decide pelo TIPO RESOLVIDO do ataque — para armas isso é `weapon.attackType`
 * (handgun, smg, heavy_weapon, melee...), não `context.type`, que é sempre
 * "weapon" (bug 3b: antes, todo ataque com arma escapava dos modificadores de
 * distância, e a lista antiga usava ids de perícia "heavy_weapons" em vez de
 * AttackType "heavy_weapon", fora "smg"). O fallback por perícia cobre chamadas
 * legadas com type: "weapon".
 *
 * É o MESMO critério que a UI usa para mostrar os Attack Modes (`AttackActions`):
 * uma lista só, para o seletor e o cálculo nunca discordarem sobre o que é
 * ataque à distância. (O nome não é `isRangedAttack` porque `rollAttack` já tem
 * uma variável local com esse nome — o teste de perícia à distância do cyberware.)
 */
export function isRangedAttackType(attackType: AttackType, skillId?: string | null): boolean {
  return (
    RANGED_ATTACK_TYPES.includes(attackType) ||
    (attackType === "weapon" && RANGED_SKILL_IDS.includes(skillId ?? ""))
  );
}

export type AttackResolution =
  | { character: Character; result: AttackRollResult }
  | { error: string };

/** Dano desarmado (Brawling e Artes Marciais) por BODY:
 * BODY 1–4 = 1d6 · 5–6 = 2d6 · 7–10 = 3d6 · 11+ = 4d6.
 * Com cyberarm instalado o resultado nunca fica abaixo de 2d6; o bônus do cyberware
 * continua sendo somado por cima (Gorilla Arms segue dando +1d6). */
export function getUnarmedDamageDice(body: number, cyberwareBonusDice = 0, hasCyberarm = false): string {
  const bodyDice = body >= 11 ? 4 : body >= 7 ? 3 : body >= 5 ? 2 : 1;
  const totalDice = bodyDice + cyberwareBonusDice;
  return `${hasCyberarm ? Math.max(totalDice, 2) : totalDice}d6`;
}

/** Resolve apenas a rolagem para acertar, sem calcular dano ou DV. */
export function rollAttack(
  character: Character,
  context: AttackContext,
  rng?: RandomSource,
): AttackResolution {
  const modifiers = context.modifiers ?? [];
  let skillId = context.skillId;
  let label = context.label || getAttackLabel(context.type);
  let weaponId = context.weaponId;
  let attackType = context.type;
  let damageDice: string | undefined;
  /** De onde vêm os dados de dano (base + bônus de cyberware), para exibir na ficha. */
  let damageSources: string[] | undefined;
  if (context.type === "brawling" || context.type === "martial_arts") {
    const unarmedBonus = getCyberwareUnarmedDamageModifiers(character);
    const bonusDice = unarmedBonus.reduce((sum, modifier) => sum + modifier.value, 0);
    const cyberarm = hasInstalledCyberarm(character);
    const withoutFloor = getUnarmedDamageDice(character.stats.BODY, bonusDice);
    damageDice = getUnarmedDamageDice(character.stats.BODY, bonusDice, cyberarm);
    damageSources = [
      `Base (BODY ${character.stats.BODY}): ${getUnarmedDamageDice(character.stats.BODY)}`,
      ...unarmedBonus.map((modifier) => `${modifier.source}: +${modifier.value}d6`),
      ...(damageDice !== withoutFloor ? ["Cyberarm: piso de 2d6"] : []),
    ];
  }
  if (context.weaponId) {
    const weapon = character.weapons.find(
      (item) => item.id === context.weaponId,
    );
    if (!weapon) return { error: "Arma não encontrada." };
    if (!weapon.attackType || !weapon.skill)
      return {
        error: `${weapon.name} não possui perfil de ataque configurado.`,
      };
    skillId = weapon.skill;
    label = weapon.name;
    weaponId = weapon.id;
    attackType = weapon.attackType;
    damageDice = weapon.damage || undefined;
  }
  if (!skillId) return { error: "Nenhuma perícia de ataque foi definida." };
  const skill = character.skills[skillId];
  if (!skill)
    return { error: `A perícia de ataque "${skillId}" não existe na ficha.` };

  // Calcula modificadores de Critical Injuries
  const injuryModifiers = getCriticalInjuryModifiers(character);
  const injuryRestrictions = getCriticalInjuryRestrictions(character);
  const twoHandedSkills = ["heavy_weapons", "shoulder_arms", "martial_arts", "melee_weapon", "brawling"];
  const selectedWeapon = context.weaponId ? character.weapons.find((weapon) => weapon.id === context.weaponId) : undefined;
  if (
    injuryRestrictions.has("cannot_use_two_handed_weapons") &&
    (selectedWeapon?.requiresTwoHands === true || twoHandedSkills.includes(skillId))
  ) {
    return { error: "Esta lesão impede o uso de armas ou ações que exigem as duas mãos." };
  }
  if (
    injuryRestrictions.has("cannot_use_lower_body") &&
    ["melee", "martial_arts", "brawling", "unarmed"].includes(attackType)
  ) {
    return { error: "Esta lesão impede ataques corpo a corpo que dependem da parte inferior do corpo." };
  }
  
  // Distância/corpo a corpo a partir do TIPO RESOLVIDO do ataque (ver isRangedAttackType).
  const isRanged = isRangedAttackType(attackType, skillId);
  const isMelee = MELEE_ATTACK_TYPES.includes(attackType);
  
  // Calcula modificadores de Critical Injury aplicáveis ao ataque
  const attackModifiers: AttackModifier[] = [...modifiers];
  
  if (injuryModifiers.rangedModifier !== 0 && isRanged) {
    attackModifiers.push({ source: "Distância (lesão)", value: injuryModifiers.rangedModifier });
  }
  if (injuryModifiers.meleeModifier !== 0 && isMelee) {
    attackModifiers.push({ source: "Corpo a corpo (lesão)", value: injuryModifiers.meleeModifier });
  }
  if (injuryModifiers.allPhysicalModifier !== 0) {
    attackModifiers.push({ source: "Físico (lesão)", value: injuryModifiers.allPhysicalModifier });
  }
  if (injuryModifiers.allActionsModifier !== 0) {
    attackModifiers.push({ source: "Todas ações (lesão)", value: injuryModifiers.allActionsModifier });
  }
  if (injuryModifiers.twoHandedModifier !== 0) {
    attackModifiers.push({ source: "Duas mãos (lesão)", value: injuryModifiers.twoHandedModifier });
  }
  const areaAttackModifier = isRanged
    ? injuryModifiers.areaModifiers.arm
    : isMelee
      ? injuryModifiers.areaModifiers.leg
      : 0;
  if (areaAttackModifier !== 0) {
    attackModifiers.push({ source: "Área afetada (lesão)", value: areaAttackModifier });
  }
  if (injuryModifiers.statModifiers[skill.stat]) {
    attackModifiers.push({ source: "STAT (lesão)", value: injuryModifiers.statModifiers[skill.stat] });
  }

  // Penalidade de HP: −2 em todas as ações quando Seriously/Mortally Wounded.
  // Pain Editor ativo zera (getWoundPenalty é a fonte única, igual ao First Aid).
  const woundPenalty = getWoundPenalty(character);
  if (woundPenalty !== 0) {
    attackModifiers.push({ source: "Lesão grave (HP)", value: woundPenalty });
  }

  // Bônus passivos do cyberware instalado (Targeting Scope, Smart Link, Gorilla Arms...)
  const weaponCatalogItemId = character.weapons.find((item) => item.id === context.weaponId)?.catalogItemId;
  const weaponCatalog = weaponCatalogItemId ? getCatalogItem(weaponCatalogItemId) : undefined;
  const isRangedAttack = ["archery", "autofire", "handgun", "heavy_weapons", "shoulder_arms"].includes(skillId);
  for (const modifier of getCyberwareAttackModifiers(character, {
    ranged: isRangedAttack,
    smart: weaponCatalog ? isSmartWeapon(weaponCatalog) : false,
    skillId,
  })) {
    attackModifiers.push(modifier);
  }
  
  // Efeito "todo teste físico" de cyberware ativado (é um ataque: sempre é físico)
  for (const modifier of getCyberwarePhysicalModifiers(character)) {
    attackModifiers.push({ source: `${modifier.source} (físico)`, value: modifier.value });
  }

  // Rolagem de 1d10 com exploding dice (crítico em 10, falha crítica em 1)
  interface RollDetail { value: number; type: "normal" | "crit" | "fumble" | "crit_add" | "fumble_sub"; }
  const allRolls: RollDetail[] = [];
  let diceTotal = 0;
  let isCritical = false;
  let isFumble = false;
  
  function rollExplodingD10(): number {
    const roll = rollDice("1d10", rng);
    const rollValue = roll.rolls[0];
    allRolls.push({ value: rollValue, type: "normal" });
    diceTotal += rollValue;
    
    // Se rolou 10, rola UMA vez mais e ADICIONA (crítico)
    if (rollValue === 10) {
      isCritical = true;
      allRolls[allRolls.length - 1].type = "crit";
      const nextRoll = rollDice("1d10", rng);
      const nextValue = nextRoll.rolls[0];
      allRolls.push({ value: nextValue, type: "crit_add" });
      diceTotal += nextValue;
      return diceTotal;
    }
    
    // Se rolou 1, rola UMA vez mais e SUBTRAI (falha crítica)
    if (rollValue === 1) {
      isFumble = true;
      allRolls[allRolls.length - 1].type = "fumble";
      const nextRoll = rollDice("1d10", rng);
      const nextValue = nextRoll.rolls[0];
      allRolls.push({ value: nextValue, type: "fumble_sub" });
      diceTotal -= nextValue;
      return diceTotal;
    }
    
    return diceTotal;
  }
  
  rollExplodingD10();

  const statValue = character.stats[skill.stat];

  const injuryModifierSum = attackModifiers.reduce((sum, m) => sum + m.value, 0);

  // Total = STAT base + perícia + d10 + modificadores.
  // `attackModifiers` já contém context.modifiers, a lesão de STAT, a lesão grave e o cyberware,
  // cada um UMA única vez. Antes o total somava `modifierTotal` (context.modifiers) E o STAT já
  // modificado à parte — context.modifiers contava em dobro (bug 2) e a lesão de STAT também (bug 1).
  const total = statValue + skill.level + diceTotal + injuryModifierSum;

  const result: AttackRollResult = {
    attackId: createId(),
    attackType,
    label,
    roll: { expression: "1d10", rolls: allRolls.map(r => r.value), total: diceTotal },
    stat: { id: skill.stat, value: statValue },
    skill: { id: skillId, value: skill.level },
    modifiers: attackModifiers,
    total,
    weaponId,
    damageDice,
    damageSources,
    naturalRoll: allRolls[0]?.value ?? 0,
    critical: isCritical,
    fumble: isFumble,
    diceRolls: allRolls,
    diceTotal,
  };
  const entry: RollHistoryEntry = {
    id: createId(),
    type: "attack",
    label,
    characterId: character.id,
    expression: `1d10${isCritical ? " (crítico!)" : ""}${isFumble ? " (falha crítica!)" : ""}`,
    rolls: allRolls.map(r => r.value),
    total,
    timestamp: new Date().toISOString(),
    attackId: result.attackId,
    attackType: result.attackType,
    weaponId,
    damageDice,
    stat: result.stat,
    skill: result.skill,
    modifiers: attackModifiers,
  };

  // Consome munição da arma com base no modo de ataque
  let updatedWeapons = character.weapons;
  if (weaponId) {
    const mode = context.attackMode ?? "normal";
    const ammoCost = mode === "autofire" || mode === "suppressive" ? 10 : 1;
    updatedWeapons = character.weapons.map((w) => {
      if (w.id !== weaponId) return w;
      if (w.ammo === undefined) return w;
      return { ...w, ammo: Math.max(0, w.ammo - ammoCost) };
    });
  }

  return {
    character: {
      ...character,
      weapons: updatedWeapons,
      lastAttack: result,
      rollHistory: [entry, ...character.rollHistory],
    },
    result,
  };
}

/** Defensive skill test. It shares Skill Base and dice rules, but is never an attack. */
export function rollEvasion(character: Character, modifiers: import("@/types/attack").AttackModifier[] = [], rng?: RandomSource): { character: Character; result: import("@/types/attack").EvasionRollResult } | { error: string } {
  const skill = character.skills.evasion;
  if (!skill) return { error: "A perícia Evasion não existe na ficha." };
  
  // Rolagem de 1d10 com exploding dice (crítico em 10, falha crítica em 1)
  interface RollDetail { value: number; type: "normal" | "crit" | "fumble" | "crit_add" | "fumble_sub"; }
  const allRolls: RollDetail[] = [];
  let diceTotal = 0;
  let isCritical = false;
  let isFumble = false;
  
  function rollExplodingD10(): number {
    const roll = rollDice("1d10", rng);
    const rollValue = roll.rolls[0];
    allRolls.push({ value: rollValue, type: "normal" });
    diceTotal += rollValue;
    
    // Se rolou 10, rola UMA vez mais e ADICIONA (crítico)
    if (rollValue === 10) {
      isCritical = true;
      allRolls[allRolls.length - 1].type = "crit";
      const nextRoll = rollDice("1d10", rng);
      const nextValue = nextRoll.rolls[0];
      allRolls.push({ value: nextValue, type: "crit_add" });
      diceTotal += nextValue;
      return diceTotal;
    }
    
    // Se rolou 1, rola UMA vez mais e SUBTRAI (falha crítica)
    if (rollValue === 1) {
      isFumble = true;
      allRolls[allRolls.length - 1].type = "fumble";
      const nextRoll = rollDice("1d10", rng);
      const nextValue = nextRoll.rolls[0];
      allRolls.push({ value: nextValue, type: "fumble_sub" });
      diceTotal -= nextValue;
      return diceTotal;
    }
    
    return diceTotal;
  }
  
  rollExplodingD10();

  // Aplica modificadores de Critical Injury
  const injuryModifiers = getCriticalInjuryModifiers(character);
  const injuryModifierTotal = injuryModifiers.allPhysicalModifier + injuryModifiers.allActionsModifier + (injuryModifiers.statModifiers[skill.stat] || 0);

  // Penalidade de HP (−2 em todas as ações); Pain Editor ativo zera.
  const woundPenalty = getWoundPenalty(character);

  // Bônus passivos de cyberware (ex.: Kerenzikov, quando aplicável)
  const allModifiers: AttackModifier[] = [
    ...modifiers,
    ...(woundPenalty !== 0 ? [{ source: "Lesão grave (HP)", value: woundPenalty }] : []),
    ...getCyberwareEvasionModifiers(character),
    ...getCyberwarePhysicalModifiers(character).map((modifier) => ({ source: `${modifier.source} (físico)`, value: modifier.value })),
  ];

  const baseSkill = getSkillBase(character, "evasion");
  const total = baseSkill + diceTotal + allModifiers.reduce((sum, item) => sum + item.value, 0) + injuryModifierTotal;
  
  const result = { 
    evasionId: createId(),
    roll: { expression: "1d10", rolls: allRolls.map(r => r.value), total: diceTotal }, 
    stat: { id: skill.stat, value: character.stats[skill.stat] }, 
    skill: { id: "evasion" as const, value: skill.level }, 
    skillBase: baseSkill, 
    modifiers: allModifiers, 
    total, 
    naturalRoll: allRolls[0]?.value ?? 0,
    critical: isCritical,
    fumble: isFumble,
    diceRolls: allRolls,
    diceTotal,
  };
  
  const entry: RollHistoryEntry = { 
    id: createId(),
    type: "evasion", 
    label: "Evasion", 
    characterId: character.id, 
    expression: `1d10${isCritical ? " (crítico!)" : ""}${isFumble ? " (falha crítica!)" : ""}`, 
    rolls: allRolls.map(r => r.value), 
    total, 
    timestamp: new Date().toISOString(), 
    stat: { id: skill.stat, value: character.stats[skill.stat] }, 
    skill: { id: "evasion", value: skill.level }, 
    modifiers: allModifiers 
  };
  
  return { character: { ...character, rollHistory: [entry, ...character.rollHistory] }, result };
}

/** Recarrega uma arma consumindo munição do inventário. Retorna erro se não houver munição. */
export function reloadWeapon(
  character: Character,
  weaponId: string,
): { character: Character } | { error: string } {
  const weapon = character.weapons.find((w) => w.id === weaponId);
  if (!weapon) return { error: "Arma não encontrada." };
  if (!weapon.magazine || weapon.magazine <= 0) return { error: `${weapon.name} não possui magazine.` };
  if (weapon.ammo !== undefined && weapon.ammo >= weapon.magazine) return { error: `${weapon.name} já está cheia.` };

  const ammoNeeded = weapon.magazine - (weapon.ammo ?? 0);

  // QUALIDADE da reserva: o MESMO classificador do bestiário e do encontro
  // (`getAmmoKind`) e a MESMA regra de escolha (`findAmmoIndexByNames`:
  // específico → genérico) — só assim o pente recebe munição compatível.
  //
  // O predicado anterior casava por QUALQUER cláusula do nome (|| solto) e
  // `find` devolvia o primeiro item que desse match, qualquer que fosse a
  // qualidade: um rifle de `shoulder_arms` enchia o pente com "Pistol
  // Ammunition" e uma pistola com "Shotgun Shells" se a escopeta tivesse sido
  // comprada primeiro (M7, reproduzido em F0.6).
  //
  // `attackType` NÃO entra aqui de propósito: na ficha do jogador ele é
  // `"handgun" | "rifle" | ...` (nunca `"ranged"`) e o classificador retornaria
  // `null` para toda arma à distância — mesmo caminho do encontro, que passa
  // só `{ name, skill }`.
  const kind = getAmmoKind({ name: weapon.name, skill: weapon.skill });
  const ammoIndex = kind ? findAmmoIndexByNames(character.inventory.map((item) => item.name), kind) : -1;
  const ammoItem = ammoIndex >= 0 ? character.inventory[ammoIndex] : undefined;
  if (!ammoItem) return { error: "Nenhuma munição encontrada no inventário." };
  if (ammoItem.quantity < ammoNeeded) return { error: `Munição insuficiente. Necessário ${ammoNeeded}, disponível ${ammoItem.quantity}.` };

  const updatedInventory = ammoItem.quantity > ammoNeeded
    ? character.inventory.map((i) => i.id === ammoItem.id ? { ...i, quantity: i.quantity - ammoNeeded } : i)
    : character.inventory.filter((i) => i.id !== ammoItem.id);

  const updatedWeapons = character.weapons.map((w) =>
    w.id === weaponId ? { ...w, ammo: w.magazine } : w,
  );

  return { character: { ...character, inventory: updatedInventory, weapons: updatedWeapons } };
}
