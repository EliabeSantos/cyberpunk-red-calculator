import { getSupplyHealAmount, isAmmoRelevantToWeapons } from "@/data/enemySupplies";
import { resolveSupplyItemId, stableItemId } from "@/data/supplyItems";
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
  const ammoNames = new Set(
    character.inventory
      .filter((item) => isAmmoRelevantToWeapons(item.name, weapons))
      .map((item) => item.name),
  );
  // F1.13.2 — itens de cura passam a ser sincronizados também: sem isto a
  // ficha local continuaria mostrando um item que a Mesa já consumiu e o
  // jogador gastaria a mesma unidade duas vezes.
  const healIds = new Set(
    character.inventory
      .filter((item) => getSupplyHealAmount(item.name) !== null)
      .map((item) => stableItemId(item.name)),
  );
  // Chave = ID ESTÁVEL (nunca o rótulo): um item renomeado/normalizado não
  // deixa de casar.
  const serverInventory = new Map(
    (combatant.supplies?.inventory ?? []).map((item) => [resolveSupplyItemId(item), item.quantity]),
  );
  const inventory = character.inventory
    .map((item) => {
      const itemId = stableItemId(item.name);
      // Munição: autoritativa sempre (como antes). Cura: só quando a Mesa
      // acompanha o item — um combate criado antes do F1.13.2 não zera a
      // ficha local por não ter recebido o item.
      if (ammoNames.has(item.name)) return { ...item, quantity: serverInventory.get(itemId) ?? 0 };
      if (healIds.has(itemId) && serverInventory.has(itemId)) {
        return { ...item, quantity: serverInventory.get(itemId) ?? 0 };
      }
      return item;
    })
    .filter((item) => item.quantity > 0);
  const armor = combatant.armor ?? character.combat.armor;
  const criticalInjuries = combatant.criticalInjuries;
  // F1.14.2 — a iniciativa que o Jogador registra via gateway aparece aqui:
  // a ficha NÃO guarda iniciativa própria durante `mesa-combat`, este é o
  // único caminho de escrita. Comparação em `?? null` para `undefined` e
  // `null` significarem a mesma coisa (sem troca de identidade à toa).
  const initiative = combatant.initiative ?? null;
  const changed =
    character.combat.hp.current !== combatant.hpCurrent ||
    character.combat.hp.max !== combatant.hpMax ||
    character.combat.isDead !== combatant.isDead ||
    character.combat.deathSaveDC !== (combatant.deathSaveDC ?? 0) ||
    character.combat.deathSaveFailures !== (combatant.deathSaveFailures ?? 0) ||
    (character.combat.initiative ?? null) !== initiative ||
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
      deathSaveDC: combatant.deathSaveDC ?? 0,
      deathSaveFailures: combatant.deathSaveFailures ?? 0,
      initiative,
    },
  };
}
