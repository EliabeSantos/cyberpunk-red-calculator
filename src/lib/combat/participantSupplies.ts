/**
 * F1.2 — A MOCHILA do participante no encontro: pente, reserva e cura.
 *
 * Extraído de `src/lib/gmStorage.ts` sem mudança de assinatura, corpo ou
 * regra (os re-exports de compatibilidade no `gmStorage` mantêm os
 * consumidores atuais intactos).
 *
 * RECARGA e CURA ficaram **no mesmo arquivo de propósito**: as duas leem a
 * MESMA mochila (`getParticipantInventory`) e aplicam o MESMO patch imutável
 * (`withParticipant`) — separá-las criaria um módulo base só para repartir
 * duas linhas de ajuda.
 *
 * Módulo puro: nada de `client-only`, `gmStorage`, React, Next, `window`,
 * `localStorage` ou Supabase. A escolha da QUALIDADE da munição continua
 * sendo `planReload`/`findAmmoIndexByNames` de `@/data/enemySupplies`
 * (regra unificada em F0.6) — nada aqui reimplementa lookup de munição.
 */
import {
  applyReload,
  consumeSupply,
  getSupplyHealAmount,
  planReload,
} from "@/data/enemySupplies";
import type { EnemySupply } from "@/types/enemy";
import type { EncounterData, EncounterParticipant } from "@/types/encounter";

/** Mochila do participante (`[]` em ficha salva anterior a esta feature). */
export function getParticipantInventory(
  participant: Pick<EncounterParticipant, "inventory">,
): EnemySupply[] {
  return participant.inventory ?? [];
}

/**
 * Estado do pente: `null` quando não há pente para gerenciar (corpo a corpo
 * ou ficha salva anterior a esta feature).
 */
export function getParticipantAmmoState(
  participant: Pick<EncounterParticipant, "ammo" | "magazine">,
): { ammo: number; magazine: number } | null {
  if (typeof participant.magazine !== "number" || participant.magazine <= 0) return null;
  const ammo = typeof participant.ammo === "number" ? participant.ammo : participant.magazine;
  return { ammo: Math.max(0, Math.min(participant.magazine, ammo)), magazine: participant.magazine };
}

export interface ParticipantReloadState {
  /** Pente agora / capacidade do pente. */
  ammo: number;
  magazine: number;
  /** Item da mochila que alimenta esta arma (`null` = nenhuma munição compatível). */
  item: EnemySupply | null;
  /** Balas ainda na reserva do item acima. */
  reserve: number;
  /** `true` quando há o que recarregar. */
  canReload: boolean;
  /** Motivo quando `canReload` é `false` — é o `title` do botão. */
  reason: string | null;
}

/**
 * Tudo que o botão ↻ Recarregar precisa saber, já resolvido.
 * `null` quando o participante não tem pente (a UI esconde o botão).
 */
export function getParticipantReloadState(
  participant: Pick<EncounterParticipant, "inventory" | "weaponName" | "weaponSkillId" | "ammo" | "magazine">,
): ParticipantReloadState | null {
  const state = getParticipantAmmoState(participant);
  if (!state) return null;

  // Mesma regra pura do melhoriário (`planReload`), com o nome da arma do
  // bestiário no lugar do objeto Weapon da ficha do jogador.
  const plan = planReload(
    { name: participant.weaponName, skill: participant.weaponSkillId },
    state.ammo,
    state.magazine,
    getParticipantInventory(participant),
  );
  return {
    ammo: plan.ammo,
    magazine: plan.magazine,
    item: plan.itemIndex >= 0 ? getParticipantInventory(participant)[plan.itemIndex] : null,
    reserve: plan.reserve,
    canReload: plan.canReload,
    reason: plan.reason,
  };
}

export interface ParticipantHealingItem {
  name: string;
  quantity: number;
  /** HP que o item restaura ao ser usado. */
  amount: number;
}

/** Itens de cura da mochila, prontos para virar botão no cartão. */
export function getParticipantHealingItems(
  participant: Pick<EncounterParticipant, "inventory">,
): ParticipantHealingItem[] {
  return getParticipantInventory(participant)
    .map((entry) => ({ name: entry.item, quantity: entry.quantity, amount: getSupplyHealAmount(entry.item) }))
    .filter((entry): entry is ParticipantHealingItem => entry.amount !== null && entry.quantity > 0);
}

/**
 * Mochila do participante no formato que a mesa guarda
 * (`mesa_combatants.supplies`): pente agora + reserva inteira.
 */
export function getParticipantSupplies(
  participant: Pick<EncounterParticipant, "weaponId" | "ammo" | "magazine" | "inventory">,
): { weaponId?: string; ammo?: number; magazine?: number; inventory: EnemySupply[] } {
  const state = getParticipantAmmoState(participant);
  return {
    weaponId: participant.weaponId,
    ammo: state?.ammo,
    magazine: state?.magazine,
    inventory: getParticipantInventory(participant),
  };
}

/** Aplica a mudança de mochila num participante, preservando o resto. */
function withParticipant(
  encounter: EncounterData,
  participantIndex: number,
  patch: Partial<EncounterParticipant>,
): EncounterData {
  const participants = [...encounter.participants];
  participants[participantIndex] = { ...participants[participantIndex], ...patch };
  return { ...encounter, participants };
}

/**
 * Recarrega o pente consumindo a reserva da mochila — mesma regra da ficha do
 * jogador (`reloadWeapon`): só entra o que falta, e a reserva diminui junto.
 */
export function reloadParticipantWeapon(
  encounter: EncounterData,
  participantIndex: number,
): { encounter: EncounterData } | { error: string } {
  const participant = encounter.participants[participantIndex];
  if (!participant) return { error: "Participante não encontrado." };

  const state = getParticipantAmmoState(participant);
  if (!state) return { error: `${participant.weaponName} não possui magazine.` };

  const inventory = getParticipantInventory(participant);
  const plan = planReload(
    { name: participant.weaponName, skill: participant.weaponSkillId },
    state.ammo,
    state.magazine,
    inventory,
  );
  const next = applyReload(plan, inventory);
  if (!next) return { error: plan.reason ?? "Recarregamento indisponível." };

  return {
    encounter: withParticipant(encounter, participantIndex, { ammo: plan.magazine, inventory: next }),
  };
}

/**
 * Usa um item de cura da mochila: consome 1 unidade e restaura HP até o máximo
 * (mesmo enquadro de `applyHealingItem` da ficha — nada de cura negativa nem
 * de passar do teto).
 *
 * A chamadora é quem espelha o HP novo na mesa (`publishMesaEnemyHp`).
 */
export function applyParticipantHealingItem(
  encounter: EncounterData,
  participantIndex: number,
  itemName: string,
): { encounter: EncounterData; healed: number } | { error: string } {
  const participant = encounter.participants[participantIndex];
  if (!participant) return { error: "Participante não encontrado." };

  const healing = getParticipantHealingItems(participant).find(
    (entry) => entry.name.toLowerCase() === itemName.trim().toLowerCase(),
  );
  if (!healing) return { error: `Sem ${itemName} na mochila.` };

  const maxHP = participant.hp.max;
  const before = Math.max(0, participant.hp.current);
  const after = Math.min(maxHP, before + healing.amount);
  if (after === before) return { error: `${participant.name} já está com HP máximo.` };

  const inventory = consumeSupply(getParticipantInventory(participant), healing.name);
  return {
    encounter: withParticipant(encounter, participantIndex, {
      hp: { current: after, max: maxHP },
      inventory,
    }),
    healed: after - before,
  };
}
