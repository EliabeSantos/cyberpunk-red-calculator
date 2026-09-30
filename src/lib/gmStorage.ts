import "client-only";

import type { Enemy, EnemySupply } from "@/types/enemy";
import type { AttackModifier } from "@/types/attack";
import type { PersonalityTrait } from "@/data/personalityTraits";
import { getEnemyImplants } from "@/data/enemyImplants";
import {
  applyReload,
  consumeSupply,
  getEnemySupplies,
  getSupplyHealAmount,
  planReload,
} from "@/data/enemySupplies";
import { rollDice } from "@/lib/dice";
import {
  getEnemyAttackModifiers,
  getEnemyBodySP,
  getEnemyEvasionModifiers,
  getEnemyInitiativeBonus,
  getEnemyInitiativeModifiers,
  getEnemyUnarmedDamageDice,
  isRangedSkillId,
  isSmartWeaponByName,
} from "@/lib/enemyCyberware";

const STORAGE_PREFIX = "cyberpunk-red-toolkit";
const ENEMIES_KEY = `${STORAGE_PREFIX}:gm:enemies:v1`;
const GM_SESSION_KEY = `${STORAGE_PREFIX}:gm:session:v1`;

interface GMSession {
  isAuthenticated: boolean;
  authenticatedAt?: string;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function isEnemy(value: unknown): value is Enemy {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "schemaVersion" in value &&
    (value as Enemy).schemaVersion === 1
  );
}

function normalizeEnemy(enemy: Enemy): Enemy {
  // Future: normalize old enemy versions if schema changes
  return {
    ...enemy,
    combat: {
      ...enemy.combat,
      criticalInjuries: enemy.combat.criticalInjuries || [],
    },
    conditions: enemy.conditions || [],
    gmNotes: enemy.gmNotes ?? "",
  };
}

export function loadEnemies(): Enemy[] {
  if (!canUseStorage()) return [];
  try {
    const value = window.localStorage.getItem(ENEMIES_KEY);
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.filter(isEnemy).map(normalizeEnemy)
      : [];
  } catch {
    return [];
  }
}

export function saveEnemies(enemies: Enemy[]): void {
  if (canUseStorage()) {
    window.localStorage.setItem(ENEMIES_KEY, JSON.stringify(enemies));
  }
}

export function upsertEnemy(enemy: Enemy): Enemy[] {
  const updated = { ...enemy, updatedAt: new Date().toISOString() };
  const enemies = loadEnemies();
  const exists = enemies.some(({ id }) => id === enemy.id);
  const next = exists
    ? enemies.map((item) => (item.id === enemy.id ? updated : item))
    : [...enemies, updated];
  saveEnemies(next);
  return next;
}

export function removeEnemy(enemyId: string): Enemy[] {
  const next = loadEnemies().filter(({ id }) => id !== enemyId);
  saveEnemies(next);
  return next;
}

export function getEnemy(enemyId: string): Enemy | null {
  return loadEnemies().find((enemy) => enemy.id === enemyId) ?? null;
}

// GM Session / Access Control
// This is a placeholder for future authentication integration.
// Currently uses a simple session flag in localStorage.
// When real auth is added, replace this with proper auth checks.
export function getGMSession(): GMSession {
  if (!canUseStorage()) return { isAuthenticated: false };
  try {
    const value = window.localStorage.getItem(GM_SESSION_KEY);
    const parsed: unknown = value ? JSON.parse(value) : { isAuthenticated: false };
    if (typeof parsed === "object" && parsed !== null && "isAuthenticated" in parsed) {
      return parsed as GMSession;
    }
    return { isAuthenticated: false };
  } catch {
    return { isAuthenticated: false };
  }
}

export function setGMSession(session: GMSession): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(GM_SESSION_KEY, JSON.stringify(session));
}

export function clearGMSession(): void {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(GM_SESSION_KEY);
}

// Helper to check GM access - replace with real auth later
export function hasGMAccess(): boolean {
  const session = getGMSession();
  return session.isAuthenticated === true;
}

// Development helper - easily enable GM access for testing
export function enableGMAccessForDevelopment(): void {
  setGMSession({ isAuthenticated: true, authenticatedAt: new Date().toISOString() });
}

// ─── Catálogo de Inimigos ───
// Importa os inimigos do catálogo do GM para o armazenamento local.
// Útil para pré-carregar inimigos sem precisar criá-los um por um.

export function importCatalogEnemies(): Enemy[] {
  // Lazy import para evitar circular dependencies
  const { gmEnemyCatalog } = require("@/data/gm-enemies");
  const enemies = gmEnemyCatalog as Enemy[];
  const existing = loadEnemies();
  const existingIds = new Set(existing.map((e) => e.id));
  const newEnemies = enemies.filter((e) => !existingIds.has(e.id));
  const combined = [...existing, ...newEnemies];
  saveEnemies(combined);
  return combined;
}

export function clearAllEnemies(): void {
  if (canUseStorage()) {
    window.localStorage.removeItem(ENEMIES_KEY);
  }
}

// ─── Encontros (Encounters) ───
// Armazena e gerencia encontros de combate ativos.

export interface EncounterParticipant {
  enemyId: string;
  /**
   * Identidade ESTÁVEL deste inimigo dentro do encontro — é o que vira
   * `source_key` na mesa (`mesa_combatants`), para o HP aplicado aqui chegar
   * à linha certa lá. Opcional só nas fichas salvas antes desta feature:
   * `ensureEncounterIds` completa na carga.
   */
  id?: string;
  name: string;
  archetype: string;
  faction: string;
  level: number;
  threatLevel: string;
  hp: { current: number; max: number };
  armor: { head: number; body: number };
  conditions: Array<{ id: string; name: string }>;
  isPlayer: boolean; // false = enemy/NPC
  // Weapon info
  weaponName: string;
  weaponSkillId: string;
  weaponSkillName: string;
  refStat: number;
  /** STAT MOVE do inimigo — alimenta o orçamento MOVE × 2 da mesa online. */
  moveStat?: number;
  skillValue: number;
  attackBase: number;
  /**
   * Nível da perícia **Evasion** do inimigo — a base do teste é REF + nível
   * (`REF` mora em `refStat`, ver `getEvasionBase`). Sorteado no nascimento do
   * participante porque é o que o botão 💨 Evasão do cartão precisa mostrar.
   * Opcional nas fichas salvas antes desta feature (mesmo molde de `moveStat`).
   */
  evasionSkillLevel?: number;
  /** Nome da perícia como está no bestiário ("Evasion") — só para exibição. */
  evasionSkillName?: string;
  damageExpression: string;
  // Last roll results
  /**
   * Último ataque. `modifiers` carrega o bônus dos implantes que entrou no
   * total (ausente nas fichas salvas antigas) — é ele que o cartão mostra.
   */
  lastAttackRoll: {
    diceRolls: number[];
    diceTotal: number;
    total: number;
    critical: boolean;
    fumble: boolean;
    modifiers?: AttackModifier[];
  } | null;
  /** `expression` é a usada na rolagem (com dados extras de implante, ex.: `1d6+1d6`). */
  lastDamageRoll: { rolls: number[]; total: number; expression?: string } | null;
  /**
   * Última rolagem de Evasão do cartão. `undefined` nas fichas salvas antes
   * desta feature — a UI trata com `!= null`, igual às demais rolagens.
   */
  lastEvasionRoll?: {
    diceRolls: number[];
    diceTotal: number;
    total: number;
    critical: boolean;
    fumble: boolean;
    modifiers?: AttackModifier[];
  } | null;
  initiative: number | null;
  // Personality traits for roleplay
  personalityTraits: PersonalityTrait[];
  /**
   * Implantes (cyberware) deste inimigo — sorteados na criação do encontro,
   * quanto maior o nível, mais implantes (`getEnemyImplants`). Contam nos
   * dados que ele rola (ataque, Evasão, Iniciativa, dano desarmado) e no SP do
   * corpo, exatamente como na ficha do jogador (`src/lib/enemyCyberware.ts`).
   * Opcional nas fichas salvas antes desta feature.
   */
  implants?: string[];
  /**
   * Capacidade do pente e balas no pente AGORA — só em arma à distância do
   * bestiário (corpo a corpo fica sem os dois). Ausente nas fichas salvas
   * antes desta feature: a UI trata com `!= null` como nas demais rolagens.
   */
  magazine?: number;
  ammo?: number;
  /**
   * Mochila do inimigo no encontro: munição da reserva e itens de cura.
   * Montada na criação (`getEnemySupplies`), que garante 2 cargas e sorteia
   * cura; ausente nas fichas salvas antes desta feature.
   */
  inventory?: EnemySupply[];
}

/**
 * Vínculo do encontro com uma PARTIDA da mesa — é o que torna o encontro de
 * uso único: lançado uma vez, ele nunca mais inicia combate (decisão de
 * 27/09/2026). Guardado junto do encontro no localStorage porque é o
 * encontro que "sabe" que já foi usado; o servidor tem a palavra final
 * (`mesa_battles.encounter_id` é UNIQUE).
 */
export interface EncounterBattle {
  sessionId: string;
  /** Código da mesa, para o aviso "em combate na Mesa XXXXX" sobreviver. */
  joinCode: string;
  status: "active" | "completed";
  startedAt: string;
  /** Só quando a partida é fechada (GM encerra, sessão encerra ou fim automático). */
  completedAt?: string;
}

export interface EncounterData {
  id: string;
  name: string;
  faction: string;
  enemyCount: number;
  participants: EncounterParticipant[];
  createdAt: string;
  /** Presente desde que este encontro tenha lançado um combate online. */
  battle?: EncounterBattle;
}

const ENCOUNTERS_KEY = `${STORAGE_PREFIX}:gm:encounters:v1`;

export function saveEncounter(encounter: EncounterData): void {
  if (!canUseStorage()) return;
  const encounters = loadEncounters();
  const existing = encounters.findIndex((e) => e.id === encounter.id);
  const next = existing >= 0
    ? encounters.map((e, i) => (i === existing ? encounter : e))
    : [...encounters, encounter];
  window.localStorage.setItem(ENCOUNTERS_KEY, JSON.stringify(next));
}

export function loadEncounters(): EncounterData[] {
  if (!canUseStorage()) return [];
  try {
    const value = window.localStorage.getItem(ENCOUNTERS_KEY);
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter(isEncounter).map(readEncounter) : [];
  } catch {
    return [];
  }
}

/**
 * Lê o vínculo `battle` gravado, descartando o que estiver corrompido.
 *
 * Um registro malformado não pode derrubar o encontro salvo inteiro nem mandar
 * `undefined` para a UI — some o vínculo e o encontro volta a ser lançável.
 */
function readBattle(raw: unknown): EncounterBattle | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const sessionId = typeof value.sessionId === "string" ? value.sessionId : "";
  const joinCode = typeof value.joinCode === "string" ? value.joinCode : "";
  const status = value.status === "completed" ? "completed" : value.status === "active" ? "active" : null;
  if (!sessionId || !joinCode || !status) return undefined;

  const battle: EncounterBattle = {
    sessionId,
    joinCode,
    status,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : "",
  };
  if (typeof value.completedAt === "string") battle.completedAt = value.completedAt;
  return battle;
}

/** Normaliza um encontro salvo: mantém o objeto original quando nada muda. */
function readEncounter(encounter: EncounterData): EncounterData {
  const battle = readBattle(encounter.battle);
  if (battle) {
    const current = encounter.battle;
    const same =
      current &&
      current.sessionId === battle.sessionId &&
      current.joinCode === battle.joinCode &&
      current.status === battle.status &&
      current.startedAt === battle.startedAt &&
      current.completedAt === battle.completedAt;
    return same ? encounter : { ...encounter, battle };
  }
  // Sem vínculo legível: garante que a chave nem apareça no objeto carregado.
  return "battle" in encounter ? { ...encounter, battle: undefined } : encounter;
}

export function getEncounter(id: string): EncounterData | null {
  return loadEncounters().find((e) => e.id === id) ?? null;
}

/**
 * Garante um `id` por participante (encontros salvos antes da espelhagem de HP).
 *
 * Devolve o MESMO objeto quando nada falta — chamadas repetidas não geram chaves
 * novas, então a chave que foi ao combate continua sendo a mesma depois de um
 * reload. Quem chama deve salvar de volta para a próxima carga já vir pronta.
 */
export function ensureEncounterIds(encounter: EncounterData): EncounterData {
  let changed = false;
  const participants = encounter.participants.map((participant) => {
    if (typeof participant.id === "string" && participant.id.length > 0) return participant;
    changed = true;
    return { ...participant, id: crypto.randomUUID() };
  });
  return changed ? { ...encounter, participants } : encounter;
}

export function deleteEncounter(id: string): void {
  if (!canUseStorage()) return;
  const next = loadEncounters().filter((e) => e.id !== id);
  window.localStorage.setItem(ENCOUNTERS_KEY, JSON.stringify(next));
}

export function clearEncounters(): void {
  if (canUseStorage()) {
    window.localStorage.removeItem(ENCOUNTERS_KEY);
  }
}

function isEncounter(value: unknown): value is EncounterData {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "participants" in value &&
    Array.isArray((value as EncounterData).participants)
  );
}

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

type ImplantBearer = Pick<EncounterParticipant, "implants">;

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
 * `true` quando o participante está de mãos livias — é a condição do bônus de
 * dano desarmado (Gorilla Arms: +1d6), a mesma que a ficha do jogador usa.
 */
export function isUnarmedParticipant(participant: Pick<EncounterParticipant, "weaponName">): boolean {
  const name = participant.weaponName.trim();
  return name === "" || name === "Desarmado";
}

/** Dados extras de dano desarmado vindos dos implantes (0 quando armado). */
function getParticipantUnarmedDamageDice(participant: ImplantBearer & Pick<EncounterParticipant, "weaponName">): number {
  return isUnarmedParticipant(participant) ? getEnemyUnarmedDamageDice(participant.implants) : 0;
}

/**
 * Expressão de dano efetiva, já com os dados extras do implante.
 * `rollDice` só aceita `NdM`, então os dados a mais entram como rolagem
 * separada em `rollDamage` — aqui fica só o rótulo mostrado ao Mestre.
 */
export function getParticipantDamageExpression(
  participant: ImplantBearer & Pick<EncounterParticipant, "weaponName" | "damageExpression">,
): string {
  const extra = getParticipantUnarmedDamageDice(participant);
  return extra > 0 ? `${participant.damageExpression}+${extra}d6` : participant.damageExpression;
}

/**
 * SP efetivo de um local de impacto: armadura do bestiário e cyberware não
 * acumulam, vale o maior — mesmo predicado de `getEffectiveArmorSP` da ficha.
 * Só o corpo tem SP de cyberware (Subdermal Armor / Skin Weave).
 */
export function getParticipantArmorSP(
  participant: Pick<EncounterParticipant, "armor" | "implants">,
  slot: "head" | "body",
): number {
  const worn = slot === "head" ? participant.armor.head : participant.armor.body;
  const cyberwareSP = slot === "body" ? getEnemyBodySP(participant.implants) : 0;
  return Math.max(worn, cyberwareSP);
}

/* -------------------------------------------------------------------------- *
 * Munição e itens de cura do participante — mesma economia da ficha do jogador.
 * -------------------------------------------------------------------------- */

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
  participant: Pick<EncounterParticipant, "ammo" | "magazine" | "inventory">,
): { ammo?: number; magazine?: number; inventory: EnemySupply[] } {
  const state = getParticipantAmmoState(participant);
  return {
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

/**
 * 1d10 com explosão no 10 e subtração no 1 — a mesma leitura da ficha.
 * `critical` é o **d10 natural** ser 10: o laço só acumula dados extras, ele
 * não decide o crítico (antes o laço regravava a flag e ela nunca sobrevivia).
 */
function rollD10Detail(): { diceRolls: number[]; diceTotal: number; critical: boolean; fumble: boolean } {
  const diceRolls: number[] = [];
  const natural = rollDice("1d10").rolls[0];
  diceRolls.push(natural);

  const critical = natural === 10;
  const fumble = natural === 1;
  let diceTotal = natural;

  if (critical) {
    let current = natural;
    while (current === 10) {
      current = rollDice("1d10").rolls[0];
      diceRolls.push(current);
      diceTotal += current;
    }
  }

  if (fumble) {
    const sub = rollDice("1d10").rolls[0];
    diceRolls.push(-sub);
    diceTotal -= sub;
  }

  return { diceRolls, diceTotal, critical, fumble };
}

export function createEncounterFromFaction(
  name: string,
  faction: string,
  enemyCount: number,
  catalog: Enemy[]
): EncounterData {
  const factionEnemies = catalog.filter((e) => e.identity.archetype && e.identity.faction === faction);

  if (factionEnemies.length === 0) {
    return {
      id: crypto.randomUUID(),
      name,
      faction,
      enemyCount,
      participants: [],
      createdAt: new Date().toISOString(),
    };
  }

  // Lazy import to avoid circular dependency issues
  const { getRandomTraits } = require("@/data/personalityTraits");

  const participants: EncounterParticipant[] = [];

  for (let i = 0; i < enemyCount; i++) {
    const source = factionEnemies[i % factionEnemies.length];
    const combat = source.combat;
    const weapon = source.weapons.length > 0 ? source.weapons[0] : null;
    const skillId = weapon?.skill ?? "brawling";
    const skill = source.skills[skillId];
    const refStat = source.stats.REF;
    const skillLevel = skill?.level ?? 0;
    const skillValue = refStat + skillLevel;
    const weaponName = weapon?.name ?? "Desarmado";
    const damageExpression = weapon?.damage ?? "1d6";
    const attackBase = weapon?.attackBase ?? skillValue;
    // Evasão: REF + nível da perícia — guardado aqui para o cartão não precisar
    // do bestiário inteiro na mão (e para encontro salvo antigo continuar íntegro).
    const evasion = getEnemyEvasionSkill(source);
    // Mochila: munição garantida (2 cargas) + cura só como possibilidade —
    // ver `getEnemySupplies` (o JSON do inimigo é a palavra final).
    const inventory = getEnemySupplies(source.inventory, weapon);
    const level =
      source.identity.threatLevel === "extreme"
        ? 4
        : source.identity.threatLevel === "high"
          ? 3
          : source.identity.threatLevel === "medium"
            ? 2
            : 1;
    participants.push({
      id: crypto.randomUUID(),
      enemyId: source.id,
      name: source.identity.name || `${source.identity.archetype} #${i + 1}`,
      archetype: source.identity.archetype || "Desconhecido",
      faction: source.identity.faction || faction,
      level,
      threatLevel: source.identity.threatLevel,
      hp: { current: combat.hp.max, max: combat.hp.max },
      armor: { ...combat.armor },
      conditions: [],
      isPlayer: false,
      weaponName,
      weaponSkillId: skillId,
      weaponSkillName: skill?.name ?? skillId,
      refStat,
      moveStat: source.stats.MOVE,
      skillValue,
      attackBase,
      evasionSkillName: evasion.name,
      evasionSkillLevel: evasion.level,
      damageExpression,
      lastAttackRoll: null,
      lastDamageRoll: null,
      lastEvasionRoll: null,
      initiative: null,
      personalityTraits: getRandomTraits(2),
      // Implantes: os do JSON do inimigo + sorteio até a cota do nível.
      implants: getEnemyImplants(source.cyberware, level),
      // Pente e mochila: só arma à distância tem (o resto fica sem os campos).
      magazine: weapon?.magazine,
      ammo: getParticipantAmmoState({ ammo: weapon?.ammo, magazine: weapon?.magazine })?.ammo,
      inventory,
    });
  }

  return {
    id: crypto.randomUUID(),
    name,
    faction,
    enemyCount,
    participants,
    createdAt: new Date().toISOString(),
  };
}

export function rollAttack(
  encounter: EncounterData,
  participantIndex: number
): EncounterData {
  const participants = [...encounter.participants];
  const p = participants[participantIndex];

  const { diceRolls, diceTotal, critical, fumble } = rollD10Detail();
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
  participantIndex: number
): EncounterData {
  const participants = [...encounter.participants];
  const p = participants[participantIndex];

  const { diceRolls, diceTotal, critical, fumble } = rollD10Detail();
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

export function rollDamage(
  encounter: EncounterData,
  participantIndex: number
): EncounterData {
  const participants = [...encounter.participants];
  const p = participants[participantIndex];
  const result = rollDice(p.damageExpression);
  const rolls = [...result.rolls];
  let total = result.total;

  // Gorilla Arms & cia.: dado extra do ataque desarmado, rolado à parte porque
  // `rollDice` só entende `NdM` (a expressão mostrada é a de
  // `getParticipantDamageExpression`, ex.: `1d6+1d6`).
  const extraDice = getParticipantUnarmedDamageDice(p);
  if (extraDice > 0) {
    const bonus = rollDice(`${extraDice}d6`);
    rolls.push(...bonus.rolls);
    total += bonus.total;
  }

  participants[participantIndex] = {
    ...p,
    lastDamageRoll: { rolls, total, expression: getParticipantDamageExpression(p) },
  };
  return { ...encounter, participants };
}

export function applyDamageToParticipant(
  encounter: EncounterData,
  participantIndex: number,
  rawDamage: number,
  ignoreArmor: boolean,
  hitLocation: "head" | "body"
): EncounterData {
  const participants = [...encounter.participants];
  const p = participants[participantIndex];
  const armor = { ...p.armor };
  // SP efetivo: armadura do bestiário e cyberware não acumulam (vale o maior);
  // só a armadura do bestiário degrada — o SP de cyberware é constante,
  // exatamente como em `src/lib/damage.ts` para a ficha do jogador.
  const armorSP = getParticipantArmorSP(p, hitLocation);

  let damage: number;
  if (ignoreArmor) {
    damage = Math.max(0, rawDamage - Math.floor(armorSP / 2));
  } else {
    damage = Math.max(0, rawDamage - armorSP);
  }

  // Armor degrades when hit breaches it
  if (rawDamage > armorSP) {
    if (hitLocation === "head") {
      armor.head = Math.max(0, armor.head - 1);
    } else {
      armor.body = Math.max(0, armor.body - 1);
    }
  }

  const newCurrent = Math.max(0, p.hp.current - damage);
  participants[participantIndex] = {
    ...p,
    hp: { ...p.hp, current: newCurrent },
    armor,
  };
  return { ...encounter, participants };
}

export function updateParticipantHP(
  encounter: EncounterData,
  participantIndex: number,
  newHP: number
): EncounterData {
  const participants = [...encounter.participants];
  participants[participantIndex] = {
    ...participants[participantIndex],
    hp: { ...participants[participantIndex].hp, current: Math.max(0, newHP) },
  };
  return { ...encounter, participants };
}

export function addParticipantCondition(
  encounter: EncounterData,
  participantIndex: number,
  condition: { id: string; name: string }
): EncounterData {
  const participants = [...encounter.participants];
  const existing = participants[participantIndex].conditions.find((c) => c.id === condition.id);
  if (existing) return encounter;
  participants[participantIndex] = {
    ...participants[participantIndex],
    conditions: [...participants[participantIndex].conditions, condition],
  };
  return { ...encounter, participants };
}

export function removeParticipantCondition(
  encounter: EncounterData,
  participantIndex: number,
  conditionId: string
): EncounterData {
  const participants = [...encounter.participants];
  participants[participantIndex] = {
    ...participants[participantIndex],
    conditions: participants[participantIndex].conditions.filter((c) => c.id !== conditionId),
  };
  return { ...encounter, participants };
}