import "client-only";

import type { Enemy } from "@/types/enemy";
import type { PersonalityTrait } from "@/data/personalityTraits";
import { getEnemyImplants } from "@/data/enemyImplants";
import { rollDice } from "@/lib/dice";

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
  lastAttackRoll: { diceRolls: number[]; diceTotal: number; total: number; critical: boolean; fumble: boolean } | null;
  lastDamageRoll: { rolls: number[]; total: number } | null;
  /**
   * Última rolagem de Evasão do cartão. `undefined` nas fichas salvas antes
   * desta feature — a UI trata com `!= null`, igual às demais rolagens.
   */
  lastEvasionRoll?: { diceRolls: number[]; diceTotal: number; total: number; critical: boolean; fumble: boolean } | null;
  initiative: number | null;
  // Personality traits for roleplay
  personalityTraits: PersonalityTrait[];
  /**
   * Implantes (cyberware) deste inimigo — sorteados na criação do encontro,
   * quanto maior o nível, mais implantes (`getEnemyImplants`). **Só descrição**,
   * igual às personalidades: não mexe em rolagem, HP ou armor. Opcional nas
   * fichas salvas antes desta feature.
   */
  implants?: string[];
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
  const total = p.attackBase + diceTotal;

  participants[participantIndex] = {
    ...p,
    lastAttackRoll: {
      diceRolls,
      diceTotal,
      total,
      critical,
      fumble,
    },
  };
  return { ...encounter, participants };
}

/**
 * Teste de **Evasão** do inimigo: REF + nível da perícia + 1d10.
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
  const total = getEvasionBase(p) + diceTotal;

  participants[participantIndex] = {
    ...p,
    lastEvasionRoll: {
      diceRolls,
      diceTotal,
      total,
      critical,
      fumble,
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
  participants[participantIndex] = {
    ...p,
    lastDamageRoll: { rolls: result.rolls, total: result.total },
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
  const armorSP = hitLocation === "head" ? armor.head : armor.body;

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