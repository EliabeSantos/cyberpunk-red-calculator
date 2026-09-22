import "client-only";

import type { Enemy } from "@/types/enemy";
import type { PersonalityTrait } from "@/data/personalityTraits";
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
  skillValue: number;
  attackBase: number;
  damageExpression: string;
  // Last roll results
  lastAttackRoll: { diceRolls: number[]; diceTotal: number; total: number; critical: boolean; fumble: boolean } | null;
  lastDamageRoll: { rolls: number[]; total: number } | null;
  initiative: number | null;
  // Personality traits for roleplay
  personalityTraits: PersonalityTrait[];
}

export interface EncounterData {
  id: string;
  name: string;
  faction: string;
  enemyCount: number;
  participants: EncounterParticipant[];
  createdAt: string;
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
    return Array.isArray(parsed) ? parsed.filter(isEncounter) : [];
  } catch {
    return [];
  }
}

export function getEncounter(id: string): EncounterData | null {
  return loadEncounters().find((e) => e.id === id) ?? null;
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
    participants.push({
      enemyId: source.id,
      name: source.identity.name || `${source.identity.archetype} #${i + 1}`,
      archetype: source.identity.archetype || "Desconhecido",
      faction: source.identity.faction || faction,
      level: source.identity.threatLevel === "extreme" ? 4 : source.identity.threatLevel === "high" ? 3 : source.identity.threatLevel === "medium" ? 2 : 1,
      threatLevel: source.identity.threatLevel,
      hp: { current: combat.hp.max, max: combat.hp.max },
      armor: { ...combat.armor },
      conditions: [],
      isPlayer: false,
      weaponName,
      weaponSkillId: skillId,
      weaponSkillName: skill?.name ?? skillId,
      refStat,
      skillValue,
      attackBase,
      damageExpression,
      lastAttackRoll: null,
      lastDamageRoll: null,
      initiative: null,
      personalityTraits: getRandomTraits(2),
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

  // Roll 1d10
  const diceRolls: number[] = [];
  let diceTotal = rollDice("1d10").rolls[0];
  diceRolls.push(diceTotal);

  let critical = diceTotal === 10;
  let fumble = diceTotal === 1;

  // Exploding dice on critical
  if (critical) {
    let current = diceTotal;
    while (current === 10) {
      current = rollDice("1d10").rolls[0];
      diceRolls.push(current);
      diceTotal += current;
      critical = current === 10; // keep tracking
    }
  }

  // Fumble: subtract a d10
  if (fumble) {
    const sub = rollDice("1d10").rolls[0];
    diceRolls.push(-sub);
    diceTotal -= sub;
  }

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