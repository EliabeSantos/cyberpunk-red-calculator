/**
 * F1.2 — ATAQUE, EVASÃO e INICIATIVA do inimigo no encontro.
 *
 * Funções extraídas de `src/lib/gmStorage.ts` **sem mudança nenhuma** de
 * assinatura, corpo ou regra: só o arquivo mudou (re-export de compatibilidade
 * em `gmStorage.ts` mantém os consumidores atuais intactos).
 *
 * Este módulo é puro: não importa `client-only`, `gmStorage`, React, Next,
 * `window`, `localStorage` nem Supabase — roda no servidor e fora do React.
 *
 * Scope: os três testes que o cartão de inimigo rola (ataque, Evasão e
 * Iniciativa) e os bônus de implantes que alimentam cada um.
 */
import { rollDice } from "@/lib/dice";
import type { RandomSource } from "@/lib/combat/contract";
import {
  getEnemyAttackModifiers,
  getEnemyEvasionModifiers,
  getEnemyInitiativeBonus,
  getEnemyInitiativeModifiers,
  isRangedSkillId,
  isSmartWeaponByName,
} from "@/lib/enemyCyberware";
import type { AttackModifier } from "@/types/attack";
import type { Enemy } from "@/types/enemy";
import type { EncounterData, EncounterParticipant, ImplantBearer } from "@/types/encounter";

/**
 * Nível da perícia **Evasion** de um inimigo do bestiário.
 *
 * A chave vem do JSON como `Evasion`, mas a busca ignora maiúsculas — se o
 * bestiário não tiver a perícia, devolve nível 0 (a base continua sendo o
 * REF, nunca `NaN`).
 */
export function getEnemyEvasionSkill(enemy: Enemy): { name: string; level: number } {
  const entry = Object.entries(enemy.skills).find(([key]) => key.toLowerCase() === "evasion");
  if (!entry) return { name: "Evasion", level: 0 };
  return { name: entry[1].name || "Evasion", level: entry[1].level ?? 0 };
}

/**
 * Base do teste de Evasão de um participante: **REF + nível da perícia**.
 * Participante de ficha antiga (sem `evasionSkillLevel`) cai em REF puro.
 */
export function getEvasionBase(participant: Pick<EncounterParticipant, "refStat" | "evasionSkillLevel">): number {
  return participant.refStat + (participant.evasionSkillLevel ?? 0);
}

/* -------------------------------------------------------------------------- *
 * Implantes do participante → mesmos efeitos da ficha do jogador.
 * Tudo passa por `src/lib/enemyCyberware.ts`, que delega para `cyberwareEffects`.
 * -------------------------------------------------------------------------- */

/** Bônus de ATAQUE dos implantes (Targeting Scope, Gorilla Arms, arma smart...). */
export function getParticipantAttackModifiers(
  participant: Pick<EncounterParticipant, "implants" | "weaponSkillId" | "weaponName">,
): AttackModifier[] {
  return getEnemyAttackModifiers(participant.implants, {
    skillId: participant.weaponSkillId,
    ranged: isRangedSkillId(participant.weaponSkillId),
    smart: isSmartWeaponByName(participant.weaponName),
  });
}

/** Bônus de EVASÃO dos implantes (Kerenzikov/Sandevistan com o estágio ligado). */
export function getParticipantEvasionModifiers(participant: ImplantBearer): AttackModifier[] {
  return getEnemyEvasionModifiers(participant.implants);
}

/** Bônus de INICIATIVA dos implantes, item a item (para mostrar a fonte). */
export function getParticipantInitiativeModifiers(participant: ImplantBearer): AttackModifier[] {
  return getEnemyInitiativeModifiers(participant.implants);
}

/** Bônus de INICIATIVA agregado — entra na conta `1d10 + REF + bônus`. */
export function getParticipantInitiativeBonus(participant: ImplantBearer): number {
  return getEnemyInitiativeBonus(participant.implants);
}

/**
 * 1d10 com explosão no 10 e subtração no 1 — a mesma leitura da ficha.
 * `critical` é o **d10 natural** ser 10: o laço só acumula dados extras, ele
 * não decide o crítico (antes o laço regravava a flag e ela nunca sobrevivia).
 */
function rollD10Detail(rng?: RandomSource): { diceRolls: number[]; diceTotal: number; critical: boolean; fumble: boolean } {
  const diceRolls: number[] = [];
  const natural = rollDice("1d10", rng).rolls[0];
  diceRolls.push(natural);

  const critical = natural === 10;
  const fumble = natural === 1;
  let diceTotal = natural;

  if (critical) {
    let current = natural;
    while (current === 10) {
      current = rollDice("1d10", rng).rolls[0];
      diceRolls.push(current);
      diceTotal += current;
    }
  }

  if (fumble) {
    const sub = rollDice("1d10", rng).rolls[0];
    diceRolls.push(-sub);
    diceTotal -= sub;
  }

  return { diceRolls, diceTotal, critical, fumble };
}

export function rollAttack(
  encounter: EncounterData,
  participantIndex: number,
  rng?: RandomSource
): EncounterData {
  const participants = [...encounter.participants];
  const p = participants[participantIndex];

  const { diceRolls, diceTotal, critical, fumble } = rollD10Detail(rng);
  const modifiers = getParticipantAttackModifiers(p);
  const total = p.attackBase + diceTotal + modifiers.reduce((sum, m) => sum + m.value, 0);

  // Consome 1 bala do pente (só arma à distância tem `ammo`) — mesma economia
  // da ficha do jogador: o valor só desce, quem decide se pode atirar é a UI.
  const ammo = typeof p.ammo === "number" ? Math.max(0, p.ammo - 1) : p.ammo;

  participants[participantIndex] = {
    ...p,
    ammo,
    lastAttackRoll: {
      diceRolls,
      diceTotal,
      total,
      critical,
      fumble,
      modifiers,
    },
  };
  return { ...encounter, participants };
}

/**
 * Teste de **Evasão** do inimigo: REF + nível da perícia + implantes + 1d10.
 *
 * Mesma economia da ficha do jogador (1 Action, quando publicada na mesa) e
 * mesmo tratamento de crítico/falha do ataque — só muda a base.
 */
export function rollEvasion(
  encounter: EncounterData,
  participantIndex: number,
  rng?: RandomSource
): EncounterData {
  const participants = [...encounter.participants];
  const p = participants[participantIndex];

  const { diceRolls, diceTotal, critical, fumble } = rollD10Detail(rng);
  const modifiers = getParticipantEvasionModifiers(p);
  const total = getEvasionBase(p) + diceTotal + modifiers.reduce((sum, m) => sum + m.value, 0);

  participants[participantIndex] = {
    ...p,
    lastEvasionRoll: {
      diceRolls,
      diceTotal,
      total,
      critical,
      fumble,
      modifiers,
    },
  };
  return { ...encounter, participants };
}
