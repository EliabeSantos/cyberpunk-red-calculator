import "client-only";

import { getSkillLabel, normalizeSkillId } from "@/data/skills";
import { getEnemySkill, withCanonicalSkillIds } from "@/types/enemy";
import type { Enemy } from "@/types/enemy";
import { getRandomTraits } from "@/data/personalityTraits";
import { getEnemyImplants } from "@/data/enemyImplants";
import { getEnemySupplies } from "@/data/enemySupplies";
import type { EncounterBattle, EncounterData, EncounterParticipant } from "@/types/encounter";
import { getParticipantAmmoState } from "@/lib/combat/participantSupplies";
import { createId } from "@/lib/id";
import { gmEnemyCatalog } from "@/data/gm-enemies";

/* -------------------------------------------------------------------------- *
 * F1.2 — RE-EXPORTS DE COMPATIBILIDADE.
 *
 * As regras de combate moravam aqui e agora vivem em `src/lib/combat/*`
 * (módulos puros, sem `client-only`, sem DOM/localStorage/Supabase). Este
 * arquivo continua expondo a MESMA API pública de antes — nenhum consumidor
 * precisou mudar de import — e importa de volta só o que a criação de
 * encontro usa internamente.
 *
 * `combat/*` NÃO importa este módulo: a seta é só para baixo.
 * -------------------------------------------------------------------------- */

export type { EncounterBattle, EncounterData, EncounterParticipant } from "@/types/encounter";

export {
  getEnemyEvasionSkill,
  getEvasionBase,
  getParticipantAttackModifiers,
  getParticipantEvasionModifiers,
  getParticipantInitiativeModifiers,
  getParticipantInitiativeBonus,
  rollAttack,
  rollEvasion,
} from "@/lib/combat/enemyAttacks";

export {
  isUnarmedParticipant,
  getParticipantDamageExpression,
  getParticipantArmorSP,
  rollDamage,
  applyDamageToParticipant,
  updateParticipantHP,
} from "@/lib/combat/enemyDamage";

export {
  getParticipantInventory,
  getParticipantAmmoState,
  getParticipantReloadState,
  getParticipantHealingItems,
  getParticipantSupplies,
  reloadParticipantWeapon,
  applyParticipantHealingItem,
} from "@/lib/combat/participantSupplies";

export type { ParticipantHealingItem, ParticipantReloadState } from "@/lib/combat/participantSupplies";

export {
  addParticipantCondition,
  removeParticipantCondition,
} from "@/lib/combat/enemyConditions";

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
  return withCanonicalSkillIds({
    ...enemy,
    combat: {
      ...enemy.combat,
      criticalInjuries: enemy.combat.criticalInjuries || [],
    },
    conditions: enemy.conditions || [],
    gmNotes: enemy.gmNotes ?? "",
  });
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
//
// As FORMAS (`EncounterParticipant`, `EncounterBattle`, `EncounterData`)
// moram em `@/types/encounter` desde o F1.2 e voltam por re-export acima,
// para que as regras de combate em `src/lib/combat/*` não precisem importar
// este módulo `client-only`.

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
  const withSkillIds = normalizeEncounterSkillIds(encounter);
  const battle = readBattle(withSkillIds.battle);
  if (battle) {
    const current = withSkillIds.battle;
    const same =
      current &&
      current.sessionId === battle.sessionId &&
      current.joinCode === battle.joinCode &&
      current.status === battle.status &&
      current.startedAt === battle.startedAt &&
      current.completedAt === battle.completedAt;
    return same ? withSkillIds : { ...withSkillIds, battle };
  }
  // Sem vínculo legível: garante que a chave nem apareça no objeto carregado.
  return "battle" in withSkillIds ? { ...withSkillIds, battle: undefined } : withSkillIds;
}

/**
 * Participante gravado antes da normalização guardava o RÓTULO da perícia da
 * arma ("Shoulder Arms") em `weaponSkillId` — o resto do sistema consulta o id
 * canônico (`shoulder_arms`) para decidir ranged/implantes/munição.
 *
 * Devolve o MESMO objeto quando nada muda, para não quebrar a identidade do
 * encontro carregado (a chave que vai ao combate continua sendo a mesma).
 */
function normalizeEncounterSkillIds(encounter: EncounterData): EncounterData {
  let changed = false;
  const participants = encounter.participants.map((participant) => {
    const raw = participant.weaponSkillId;
    // Ficha gravada antes do campo existir: deixa como está.
    if (typeof raw !== "string" || raw.length === 0) return participant;
    const canonical = normalizeSkillId(raw);
    if (canonical === raw) return participant;
    changed = true;
    return { ...participant, weaponSkillId: canonical };
  });
  return changed ? { ...encounter, participants } : encounter;
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
    return { ...participant, id: createId() };
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
 * Materializa o roster em participantes.
 *
 * `roster` vem pronto de `buildEncounterRoster` — é a MESMA lista que o
 * preview mostra (identidade, ordem e quantidade). Aqui não se sorteia nem se
 * escolhe inimigo de novo: cada posição vira UMA instância com `id` próprio.
 * O filtro abaixo é só a garantia de que a facção bate; roster vazio → zero
 * participantes, exatamente o que a tela mostrou.
 */
export function createEncounterFromFaction(
  name: string,
  faction: string,
  enemyCount: number,
  roster: Enemy[]
): EncounterData {
  const factionEnemies = roster.filter((e) => e.identity.archetype && e.identity.faction === faction);

  if (factionEnemies.length === 0) {
    return {
      id: createId(),
      name,
      faction,
      enemyCount,
      participants: [],
      createdAt: new Date().toISOString(),
    };
  }

  const participants: EncounterParticipant[] = [];

  for (let i = 0; i < enemyCount; i++) {
    const source = factionEnemies[i % factionEnemies.length];
    const combat = source.combat;
    const weapon = source.weapons.length > 0 ? source.weapons[0] : null;
    const skillId = normalizeSkillId(weapon?.skill ?? "brawling");
    const skill = getEnemySkill(source.skills, skillId);
    const refStat = source.stats.REF;
    const skillLevel = skill?.level ?? 0;
    const skillValue = refStat + skillLevel;
    const weaponName = weapon?.name ?? "Desarmado";
    const damageExpression = weapon?.damage ?? "1d6";
    const attackBase = weapon?.attackBase ?? skillValue;
    // Evasão: REF + nível da perícia — guardado aqui para o cartão não precisar
    // do bestiário inteiro na mão (e para encontro salvo antigo continuar íntegro).
    // O nível só entra no participante quando a perícia existe no bestiário.
    // O fallback legado de getEnemyEvasionSkill não pode virar defesa no snapshot.
    const evasion = getEnemySkill(source.skills, "evasion");
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
      id: createId(),
      enemyId: source.id,
      name: source.identity.name || `${source.identity.archetype} #${i + 1}`,
      archetype: source.identity.archetype || "Desconhecido",
      faction: source.identity.faction || faction,
      level,
      threatLevel: source.identity.threatLevel,
      hp: { current: combat.hp.max, max: combat.hp.max },
      armor: { ...combat.armor },
      conditions: [],
      criticalInjuries: [...(combat.criticalInjuries ?? [])],
      isPlayer: false,
      weaponName,
      weaponId: weapon?.id,
      weaponAttackType: weapon?.attackType,
      weaponRateOfFire: weapon?.rateOfFire,
      requiresTwoHands: weapon?.requiresTwoHands,
      weaponSkillId: skillId,
      weaponSkillName: skill?.name ?? getSkillLabel(skillId),
      refStat,
      dexStat: source.stats.DEX,
      moveStat: source.stats.MOVE,
      skillValue,
      attackBase,
      ...(evasion
        ? { evasionSkillName: evasion.name, evasionSkillLevel: evasion.level, evasionSkillStat: evasion.stat }
        : {}),
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
    id: createId(),
    name,
    faction,
    enemyCount,
    participants,
    createdAt: new Date().toISOString(),
  };
}
