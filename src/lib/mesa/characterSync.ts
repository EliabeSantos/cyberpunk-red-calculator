import { isAmmoRelevantToWeapons } from "@/data/enemySupplies";
import type { MesaState, MesaCombatant } from "@/lib/mesa/types";
import type { Character } from "@/types/character";

/** Projeta somente o estado mutável autoritativo da Mesa sobre a ficha local. */
export function syncMesaCharacterState(character: Character, state: MesaState | null): Character {
  if (!state?.viewer.participantId) return character;
  const combatant = state.combatants.find(
    (entry) => entry.kind === "character" &&
      entry.characterId === character.id &&
      entry.participantId === state.viewer.participantId,
  );
  return combatant ? applyCombatantState(character, combatant) : character;
}

export function applyCombatantState(character: Character, combatant: MesaCombatant): Character {
  const ammo = combatant.ammoByWeapon ?? {};
  const weapons = character.weapons.map((weapon) =>
    Object.prototype.hasOwnProperty.call(ammo, weapon.id)
      ? { ...weapon, ammo: ammo[weapon.id] }
      : weapon,
  );
  const relevantNames = new Set(
    character.inventory
      .filter((item) => isAmmoRelevantToWeapons(item.name, weapons))
      .map((item) => item.name),
  );
  const serverInventory = new Map(
    (combatant.supplies?.inventory ?? []).map((item) => [item.item, item.quantity]),
  );
  const inventory = character.inventory
    .map((item) => relevantNames.has(item.name)
      ? { ...item, quantity: serverInventory.get(item.name) ?? 0 }
      : item)
    .filter((item) => item.quantity > 0);
  const armor = combatant.armor ?? character.combat.armor;
  const criticalInjuries = combatant.criticalInjuries;
  const changed =
    character.combat.hp.current !== combatant.hpCurrent ||
    character.combat.hp.max !== combatant.hpMax ||
    character.combat.isDead !== combatant.isDead ||
    JSON.stringify(character.combat.armor) !== JSON.stringify(armor) ||
    JSON.stringify(character.combat.criticalInjuries) !== JSON.stringify(criticalInjuries) ||
    JSON.stringify(character.weapons) !== JSON.stringify(weapons) ||
    JSON.stringify(character.inventory) !== JSON.stringify(inventory);
  if (!changed) return character;
  return {
    ...character,
    weapons,
    inventory,
    combat: {
      ...character.combat,
      hp: { current: combatant.hpCurrent, max: combatant.hpMax },
      armor,
      criticalInjuries,
      isDead: combatant.isDead,
    },
  };
}
