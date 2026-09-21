import { getSkillBase, getCriticalInjuryModifiers } from "@/lib/calculations";
import { rollDice } from "@/lib/dice";
import type {
  AttackContext,
  AttackRollResult,
  AvailableAttack,
  AttackModifier,
} from "@/types/attack";
import type { Character, RollHistoryEntry } from "@/types/character";

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
  const martialArts = character.skills.martial_arts;
  const brawling = character.skills.brawling;
  const skillAttacks: AvailableAttack[] =
    martialArts && martialArts.level > 0
      ? [
          {
            id: "skill:martial_arts",
            label: martialArts.name,
            detail: `${martialArts.stat} + ${martialArts.name} + 1d10`,
            source: "skill",
            context: { type: "martial_arts", skillId: "martial_arts" },
          },
        ]
      : [];
  const brawlingAttack: AvailableAttack[] = brawling && brawling.level > 0 ? [{ id: "skill:brawling", label: brawling.name, detail: `${brawling.stat} + ${brawling.name} + 1d10`, source: "skill", context: { type: "brawling", skillId: "brawling" } }] : [];
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
export type AttackResolution =
  | { character: Character; result: AttackRollResult }
  | { error: string };

function getUnarmedDamageDice(body: number): string {
  if (body >= 9) return "4d6";
  if (body >= 7) return "3d6";
  if (body >= 5) return "2d6";
  return "1d6";
}

/** Resolve apenas a rolagem para acertar, sem calcular dano ou DV. */
export function rollAttack(
  character: Character,
  context: AttackContext,
): AttackResolution {
  const modifiers = context.modifiers ?? [];
  let skillId = context.skillId;
  let label = getAttackLabel(context.type);
  let weaponId = context.weaponId;
  let attackType = context.type;
  let damageDice: string | undefined;
  if (context.type === "brawling" || context.type === "martial_arts") {
    damageDice = getUnarmedDamageDice(character.stats.BODY);
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
  
  // Determina se é ataque à distância ou corpo a corpo
  const isRanged = ["archery", "autofire", "handgun", "heavy_weapons", "shoulder_arms", "rifle", "sniper", "shotgun", "thrown_weapon", "grenade"].includes(context.type as string);
  const isMelee = ["melee", "martial_arts", "brawling", "unarmed"].includes(context.type as string);
  
  // Calcula modificadores de Critical Injury aplicáveis ao ataque
  const attackModifiers: AttackModifier[] = [...context.modifiers ?? []];
  
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
  if (injuryModifiers.statModifiers[skill.stat]) {
    attackModifiers.push({ source: "STAT (lesão)", value: injuryModifiers.statModifiers[skill.stat] });
  }
  
  // Rolagem de 1d10 com exploding dice (crítico em 10, falha crítica em 1)
  interface RollDetail { value: number; type: "normal" | "crit" | "fumble" | "crit_add" | "fumble_sub"; }
  let allRolls: RollDetail[] = [];
  let diceTotal = 0;
  let isCritical = false;
  let isFumble = false;
  
  function rollExplodingD10(): number {
    const roll = rollDice("1d10");
    const rollValue = roll.rolls[0];
    allRolls.push({ value: rollValue, type: "normal" });
    diceTotal += rollValue;
    
    // Se rolou 10, rola UMA vez mais e ADICIONA (crítico)
    if (rollValue === 10) {
      isCritical = true;
      allRolls[allRolls.length - 1].type = "crit";
      const nextRoll = rollDice("1d10");
      const nextValue = nextRoll.rolls[0];
      allRolls.push({ value: nextValue, type: "crit_add" });
      diceTotal += nextValue;
      return diceTotal;
    }
    
    // Se rolou 1, rola UMA vez mais e SUBTRAI (falha crítica)
    if (rollValue === 1) {
      isFumble = true;
      allRolls[allRolls.length - 1].type = "fumble";
      const nextRoll = rollDice("1d10");
      const nextValue = nextRoll.rolls[0];
      allRolls.push({ value: nextValue, type: "fumble_sub" });
      diceTotal -= nextValue;
      return diceTotal;
    }
    
    return diceTotal;
  }
  
  rollExplodingD10();

  // Calcula o total do STAT com modificadores de lesão
  const statValue = character.stats[skill.stat];
  const statModifier = injuryModifiers.statModifiers[skill.stat] || 0;
  const modifiedStatValue = statValue + statModifier;
  
  const baseSkill = getSkillBase(character, skillId);
  const modifierTotal = modifiers.reduce(
    (total, modifier) => total + modifier.value,
    0,
  );
  
  const injuryModifierSum = attackModifiers.reduce((sum, m) => sum + m.value, 0);

  const total = modifiedStatValue + skill.level + diceTotal + modifierTotal + injuryModifierSum;

  const result: AttackRollResult = {
    attackId: crypto.randomUUID(),
    attackType,
    label,
    roll: { expression: "1d10", rolls: allRolls.map(r => r.value), total: diceTotal },
    stat: { id: skill.stat, value: modifiedStatValue },
    skill: { id: skillId, value: skill.level },
    modifiers: attackModifiers,
    total,
    weaponId,
    damageDice,
    naturalRoll: allRolls[0]?.value ?? 0,
    critical: isCritical,
    fumble: isFumble,
    diceRolls: allRolls,
    diceTotal,
  };
  const entry: RollHistoryEntry = {
    id: crypto.randomUUID(),
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
export function rollEvasion(character: Character, modifiers: import("@/types/attack").AttackModifier[] = []): { character: Character; result: import("@/types/attack").EvasionRollResult } | { error: string } {
  const skill = character.skills.evasion;
  if (!skill) return { error: "A perícia Evasion não existe na ficha." };
  
  // Rolagem de 1d10 com exploding dice (crítico em 10, falha crítica em 1)
  interface RollDetail { value: number; type: "normal" | "crit" | "fumble" | "crit_add" | "fumble_sub"; }
  let allRolls: RollDetail[] = [];
  let diceTotal = 0;
  let isCritical = false;
  let isFumble = false;
  
  function rollExplodingD10(): number {
    const roll = rollDice("1d10");
    const rollValue = roll.rolls[0];
    allRolls.push({ value: rollValue, type: "normal" });
    diceTotal += rollValue;
    
    // Se rolou 10, rola UMA vez mais e ADICIONA (crítico)
    if (rollValue === 10) {
      isCritical = true;
      allRolls[allRolls.length - 1].type = "crit";
      const nextRoll = rollDice("1d10");
      const nextValue = nextRoll.rolls[0];
      allRolls.push({ value: nextValue, type: "crit_add" });
      diceTotal += nextValue;
      return diceTotal;
    }
    
    // Se rolou 1, rola UMA vez mais e SUBTRAI (falha crítica)
    if (rollValue === 1) {
      isFumble = true;
      allRolls[allRolls.length - 1].type = "fumble";
      const nextRoll = rollDice("1d10");
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
  
  const baseSkill = getSkillBase(character, "evasion");
  const total = baseSkill + diceTotal + modifiers.reduce((sum, item) => sum + item.value, 0) + injuryModifierTotal;
  
  const result = { 
    evasionId: crypto.randomUUID(), 
    roll: { expression: "1d10", rolls: allRolls.map(r => r.value), total: diceTotal }, 
    stat: { id: skill.stat, value: character.stats[skill.stat] }, 
    skill: { id: "evasion" as const, value: skill.level }, 
    skillBase: baseSkill, 
    modifiers, 
    total, 
    naturalRoll: allRolls[0]?.value ?? 0,
    critical: isCritical,
    fumble: isFumble,
    diceRolls: allRolls,
    diceTotal,
  };
  
  const entry: RollHistoryEntry = { 
    id: crypto.randomUUID(), 
    type: "evasion", 
    label: "Evasion", 
    characterId: character.id, 
    expression: `1d10${isCritical ? " (crítico!)" : ""}${isFumble ? " (falha crítica!)" : ""}`, 
    rolls: allRolls.map(r => r.value), 
    total, 
    timestamp: new Date().toISOString(), 
    stat: { id: skill.stat, value: character.stats[skill.stat] }, 
    skill: { id: "evasion", value: skill.level }, 
    modifiers 
  };
  
  return { character: { ...character, rollHistory: [entry, ...character.rollHistory] }, result };
}

/** Mapeia subtipo de arma para a categoria de munição correspondente no inventário. */
const ammoCategoryMap: Record<string, string> = {
  handgun: "pistol_ammo",
  smg: "smg_ammo",
  rifle: "rifle_ammo",
  shotgun: "shotgun_shells",
  heavy: "rifle_ammo",
};

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

  const ammoCategory = weapon.skill ? ammoCategoryMap[weapon.skill] ?? "ammunition" : "ammunition";
  const ammoItem = character.inventory.find(
    (item) => item.category === "ammunition" && item.name.toLowerCase().includes(ammoCategory.replace("_", " "))
      || item.catalogItemId === ammoCategory
      || item.name.toLowerCase().includes("ammo")
      || item.name.toLowerCase().includes("munição")
      || item.name.toLowerCase().includes("municao")
      || item.name.toLowerCase().includes("shells")
  );
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