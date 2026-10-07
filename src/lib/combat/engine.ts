/**
 * F1.5 — MOTOR: `engine.execute(state, action, rng) → CombatResult`.
 *
 * Primeira integração real do contrato do F1.1: uma `CombatAction` entra, a
 * regra canônica roda e um `CombatResult` sai — estado novo + `changes` +
 * `rolls` + `events`.
 *
 * ## O que está integrado (e o que não)
 *
 * Três ações: `damage` (F1.5), `attack` (F1.8C — com ROF, modos de ataque,
 * Autofire e Supressive das F1.8D.5–F1.8D.7) e `evasion` (F1.8D.9, a
 * rolagem standalone que antes só existia no caminho legado da ficha e do
 * encontro). As demais ações continuam devolvendo erro estruturado — a API é
 * uma só e cresce por ação, nunca por engine paralelo.
 *
 * ## Camadas (direção: UI/adapters → combate → regras)
 *
 *     CombatAction ─► execute ─► applyDamage (F1.3)          SP/absorção/degradação/derrota
 *                                woundThresholdCrossed (F1.3) limiar de Seriously Wounded
 *                                getWoundPenalty (fonte única) penalidade sobre o HP novo
 *                                rollCriticalInjuryDetail     lesão crítica + 2d6 (RandomSource)
 *
 * O motor **não tem regra própria**: valida, delega e monta o resultado —
 * e, desde o F1.8D.1, devolve também o `DamageResult` (F1.8D.1), o espelho
 * daquela decisão para o adapter/event layer não recalcular nada.
 *
 * ## O que ele NÃO faz (escopo F1.5)
 *
 *  • não rola o valor do dano — `DamageAction.amount` chega pronto (F1.3,
 *    §ROLL×APPLICATION); o único sorteio aqui é o 2d6 da Critical Injury;
 *  • não debita Actions/movimento: `damage` não é `CombatActionType`, o eixo
 *    de custo continua sendo `combatEngine.ts`/`ACTION_COSTS`;
 *  • não inicializa `deathSaveDC = BODY` nem aplica modificador de Death
 *    Save (pendências F1.0 §13, registradas sem correção);
 *  • não grava nada: `events` sai pronto para o F1.6 ligar em
 *    `store.appendEvent`;
 *  • não muta `state` — nem em sucesso, nem em falha.
 *
 * Módulo puro: sem React, Next, DOM, `localStorage`, Supabase, `gmStorage`,
 * `client-only` nem componente algum (testado em `combat-purity.test.ts`).
 */
import { getWoundPenalty, getCriticalInjuryModifiers, getCriticalInjuryRestrictions } from "@/lib/calculations";
import { isCriticalInjuryUnconsciousAtRound, rollCriticalInjuryDetail, type CriticalInjuryRoll } from "@/data/criticalInjuries";
import { getCatalogItem } from "@/data/items";
import { armorSlotForLocation, hitLocations } from "@/types/combat";
import type { AttributeName, CombatStats } from "@/types/character";
import { browserRandom } from "@/lib/dice";
import type { DiceResult } from "@/lib/dice";
import {
  applyDamage,
  ENEMY_DAMAGE_POLICY,
  PLAYER_DAMAGE_POLICY,
} from "@/lib/combat/damage";
import type { ArmorRule, DamagePolicy } from "@/lib/combat/damage";
import type {
  CombatAction,
  CombatErrorCode,
  CombatParticipant,
  CombatResult,
  CombatRoll,
  CombatState,
  CombatStateChange,
  RandomSource,
} from "@/lib/combat/contract";
import {
  getCyberwareAttackModifiers,
  getCyberwareEvasionModifiers,
  getCyberwarePhysicalModifiers,
  isSmartWeapon,
} from "@/lib/cyberwareEffects";
import type { AttackAction, AttackResult, DefenseContext, CombatError, DamageResult, EvasionAction, EvasionResult } from "@/lib/combat/contract";
import type { AttackModifier, AttackType } from "@/types/attack";

/** Falha estruturada: devolve o MESMO estado, porque nada chegou a ser aplicado. */
function failure(state: CombatState, code: CombatErrorCode, message: string): CombatResult {
  return { ok: false, state, changes: [], rolls: [], events: [], errors: [{ code, message }] };
}

function findParticipant(state: CombatState, id: string): CombatParticipant | undefined {
  return state.participants.find((participant) => participant.id === id);
}

/**
 * Resolve UMA `CombatAction` sobre `state`, sem mutá-lo.
 *
 * `rng` é a mesma fonte injetável do F1.4 (`RandomSource`), no lugar de
 * sempre: último parâmetro opcional, `browserRandom` por padrão. O motor não
 * chama `Math.random` nem cria outro sistema de RNG — quem rola é a regra
 * canônica, com a fonte que ele repassa.
 */
export function execute(
  state: CombatState,
  action: CombatAction,
  rng: RandomSource = browserRandom,
): CombatResult {
  /* ----------------------------- validação (§9) ---------------------------- */

  /* ---- ATAQUE (F1.8C) ---- */
  if (action.type === "attack") {
    return executeAttack(state, action, rng);
  }

  /* ---- EVASÃO STANDALONE (F1.8D.9) ---- */
  if (action.type === "evasion") {
    return executeEvasion(state, action, rng);
  }

  if (action.type !== "damage") {
    return failure(
      state,
      "invalid_action",
      `Ação "${action.type}" ainda não passa pelo motor (resolvidas: damage, attack, evasion).`,
    );
  }

  // Mesmo vocabulário de `resolveAction` (`combatEngine.ts:131`) e o mesmo
  // recuo de `store.syncCombatHp`, que não aceita HP quando a mesa terminou.
  if (state.status === "finished") {
    return failure(state, "combat_finished", "Combate encerrado: ação não aceita.");
  }

  // `actorId` é opcional (dano de fonte externa/GM); quando existe, vale a
  // mesma regra de `resolveAction`: precisa existir e não pode estar morto.
  if (action.actorId !== null) {
    const actor = findParticipant(state, action.actorId);
    if (!actor) {
      return failure(state, "unknown_participant", `Participante ${action.actorId} não existe no combate.`);
    }
    if (actor.combat.isDead) {
      return failure(state, "combatant_defeated", `${actor.name} está fora do combate.`);
    }
  }

  const target = findParticipant(state, action.targetId);
  if (!target) {
    return failure(state, "unknown_participant", `Alvo ${action.targetId} não existe no combate.`);
  }

  // O alvo morto NÃO é recusado aqui: o contrato não modela essa proibição e
  // dano aplicado a um já derrubado é decisão de mesa (gap registrado).
  if (action.hitLocation !== undefined && !hitLocations.includes(action.hitLocation)) {
    return failure(state, "invalid_action", `Local de impacto inválido: ${String(action.hitLocation)}.`);
  }

  // Dado obrigatório: é a MESMA validação de `applyReceivedDamage`
  // (`src/lib/damage.ts:79`) — inteiro e positivo, mesma mensagem.
  if (!Number.isInteger(action.amount) || action.amount <= 0) {
    return failure(state, "invalid_action", "Dano inválido.");
  }

  /* ------------------------------ resolução ------------------------------- */

  const location = action.hitLocation ?? "body";
  const slot = armorSlotForLocation(location);
  // Política pelo TIPO do alvo, como já fazem a ficha (sempre `player`), a
  // mesa (`syncCombatHp` decide pelo inimigo ter `sourceKey`) e a regra
  // canônica (`ENEMY_DAMAGE_POLICY.kind = "enemy"`).
  const policy: DamagePolicy = target.type === "enemy" ? ENEMY_DAMAGE_POLICY : PLAYER_DAMAGE_POLICY;
  // `armorRule` explícito manda; sem ele vale o atalho legado `ignoreArmor`.
  const armorRule: ArmorRule = action.armorRule ?? (action.ignoreArmor ? "ignore" : "full");

  const outcome = applyDamage(
    {
      hp: target.combat.hp.current,
      wornArmorSP: target.combat.armor[slot],
      cyberwareSP: target.combat.cyberwareSP?.[slot] ?? 0,
      isDead: target.combat.isDead,
    },
    action.amount,
    policy,
    armorRule,
    location === "head" ? 2 : 1,
  );

  /* ------------------- Critical Injury (aqui entra o rng) ------------------- */

  const injuries = [...target.combat.criticalInjuries];
  let injuryRoll: CombatRoll | null = null;
  let addedInjury: CombatStateChange | null = null;
  // F1.8D.4: o par (lesão + 2d6) já resolvido, guardado UMA vez para o
  // `DamageResult` expor o mesmo objeto — não uma segunda cópia.
  let injuryOutcome: CriticalInjuryRoll | null = null;

  // Player e Enemy usam o mesmo modelo de Critical Injury. A ausência de
  // Death Save só muda a política de morte, não se a lesão é rastreada.
  const tracksInjuries = true;
  const hpAfterSpecial = outcome.hpAfter;

  // O único gatilho de Critical Injury é 2+ resultados 6 nos dados de dano.
  // Wound Threshold/Seriously Wounded, HP 0 e Mortal Wound são estados
  // independentes e não geram uma lesão.
  const criticalFromDamageDice = (action.damageRolls ?? []).filter((roll) => roll === 6).length >= 2;
  if (tracksInjuries && criticalFromDamageDice) {
    const resultado = rollCriticalInjuryDetail(
      location,
      new Set(target.combat.criticalInjuries.map((injury) => injury.name)),
      rng,
    );
    const injury = resultado.injury.unconsciousRounds
      ? { ...resultado.injury, unconsciousUntilRound: state.round + resultado.injury.unconsciousRounds - 1 }
      : resultado.injury;
    injuryOutcome = { ...resultado, injury };
    injuries.push(injury);
    addedInjury = { type: "critical_injury_added", participantId: target.id, injury };
    injuryRoll = {
      kind: "critical_injury",
      actorId: action.actorId,
      targetId: target.id,
      expression: resultado.roll.expression,
      rolls: [...resultado.roll.rolls],
      total: resultado.roll.total,
    };
  }

  const criticalInjuryBonusDamage = injuryOutcome?.injury.bonusDamage ?? 0;
  const hpAfterCriticalInjury = hpAfterSpecial - criticalInjuryBonusDamage;
  const finalIsDead = policy.defeatFromHp ? hpAfterCriticalInjury <= 0 : outcome.isDeadAfter;

  /* ---------------------- mudanças + estado (imutável) ---------------------- */

  const changes: CombatStateChange[] = [];
  if (hpAfterCriticalInjury !== outcome.hpBefore) {
    changes.push({
      type: "hp_changed",
      participantId: target.id,
      before: outcome.hpBefore,
      after: hpAfterCriticalInjury,
    });
  }
  if (outcome.wornArmorSPAfter !== target.combat.armor[slot]) {
    changes.push({
      type: "armor_changed",
      participantId: target.id,
      location: slot,
      before: target.combat.armor[slot],
      after: outcome.wornArmorSPAfter,
    });
  }
  if (addedInjury) changes.push(addedInjury);
  if (finalIsDead !== outcome.isDeadBefore) {
    changes.push({
      type: "is_dead_changed",
      participantId: target.id,
      before: outcome.isDeadBefore,
      after: finalIsDead,
    });
  }

  const armor =
    slot === "head"
      ? { ...target.combat.armor, head: outcome.wornArmorSPAfter }
      : { ...target.combat.armor, body: outcome.wornArmorSPAfter };

  const participants = state.participants.map((participant) =>
    participant.id !== target.id
      ? participant
      : {
          ...participant,
          combat: {
            ...participant.combat,
            hp: { ...participant.combat.hp, current: hpAfterCriticalInjury },
            armor,
            criticalInjuries: injuries,
            // F1.7.1 (Decisão A): o estado resultante REFLETE a derrota que o
            // `is_dead_changed` acima já declara — mesma fonte
            // (`outcome.isDeadAfter`, produzido por `isDefeatedBy` dentro de
            // `applyDamage`), nunca uma re-derivada `hp <= 0`. A política de
            // jogador continua preservada: `PLAYER_DAMAGE_POLICY` devolve
            // `isDeadAfter = isDeadBefore`, então ficha a 0 HP segue viva
            // (quem derruba personagem é o Death Save, fora deste motor).
            isDead: finalIsDead,
          },
        },
  );

  /* ---------------------- DamageResult (F1.8D.1) --------------------------- */

  // O que a regra canônica decidiu, espelhado para o adapter/event layer não
  // precisar recalcular SP, absorção, HP ou penalidade. Nada aqui é fórmula
  // nova: cada campo é lido de `applyDamage` (F1.3), de `getWoundPenalty`
  // (fonte única, a MESMA que ataque, perícia e First Aid usam), avaliada
  // sobre o HP já atualizado, ou da própria resolução (`hitLocation`, a
  // localização que já guiou armadura e lesão — F1.8D.3 só a expõe — e
  // `criticalInjury`, o par lesão + 2d6 que a resolução já rolou — F1.8D.4).
  const damageResult: DamageResult = {
    damageId: `${action.actorId ?? "externo"}-${target.id}-${Date.now()}`,
    actorId: action.actorId,
    targetId: target.id,
    // A MESMA localização que as linhas acima usaram para o slot de armadura
    // e para as Critical Injury (F1.8D.3 — transporte, sem regra nova).
    hitLocation: location,
    rawDamage: outcome.damage,
    armorValue: outcome.armorSPBefore,
    damageAbsorbed: outcome.damageAbsorbed,
    damageAfterArmor: outcome.damageToHP + criticalInjuryBonusDamage,
    hpBefore: outcome.hpBefore,
    hpAfter: hpAfterCriticalInjury,
    woundPenalty: getWoundPenalty({
      // `CombatHealth` do contrato × `CombatStats` da ficha — mesmo recorte
      // documentado no F1.8C (`resolveAttackModifiers`): `getWoundPenalty`
      // lê só hp/isDead e, pelo `cyberware`, o Pain Editor.
      combat: {
        ...target.combat,
        hp: { ...target.combat.hp, current: hpAfterCriticalInjury },
        isDead: finalIsDead,
      } as unknown as CombatStats,
      cyberware: toCyberwareItems(target.cyberware),
    }),
    // F1.8D.4: a lesão que este MESMO dano já rolou, se rolou. `?? undefined`
    // mantém o campo sempre legível; ausente = nenhuma lesão gerada.
    criticalInjury: injuryOutcome ?? undefined,
    specialCriticalInjury: undefined,
    changes,
  };

  return {
    ok: true,
    state: { ...state, participants },
    changes,
    rolls: injuryRoll ? [injuryRoll] : [],
    events: [],
    damageResult,
  };
}

/**
 * O nome documentado no contrato (`docs/combat-engine-contract.md`, F1.5):
 * `engine.execute(state, action, rng) → CombatResult`. É a MESMA função de
 * `execute` — dois nomes, uma implementação, nenhuma lógica duplicada.
 */
export const engine = { execute };

/* ==========================================================================
 * F1.8C — ATTACK ENGINE
 * ========================================================================== */

/** Tipos canônicos de ataque à distância (copiado de `attacks.ts`). */
const RANGED_ATTACK_TYPES = new Set([
  "handgun",
  "smg",
  "rifle",
  "shotgun",
  "sniper",
  "heavy_weapon",
  "thrown_weapon",
  "grenade",
  "exotic_weapon",
]);

/** Perícias canônicas à distância (copiado de `attacks.ts`). */
const RANGED_SKILL_IDS = new Set([
  "archery",
  "autofire",
  "handgun",
  "heavy_weapons",
  "shoulder_arms",
]);

/** Converte `CombatCyberwareItem[]` → `CyberwareItem[]` mínimo para os helpers de efeitos. */
function toCyberwareItems(
  cyberware?: Array<{ name: string; catalogItemId?: string; activeStage?: number }>,
) {
  return (cyberware ?? []).map((item) => ({
    id: item.catalogItemId ?? item.name,
    catalogItemId: item.catalogItemId,
    name: item.name,
    installedAt: "",
    activeStage: item.activeStage,
  }));
}

/** Determina se um ataque é à distância baseado em type/skillId. */
function isRangedAttackType(attackType: string, skillId?: string): boolean {
  return RANGED_ATTACK_TYPES.has(attackType) || (skillId ? RANGED_SKILL_IDS.has(skillId) : false);
}

/**
 * Rolagem canônica de 1d10 com exploding:
 * - primeiro 10 → 1 dado adicional, soma, para
 * - primeiro 1  → 1 dado adicional, subtrai, para
 * - sem cadeia.
 */
function rollAttackDice(rng: RandomSource): DiceResult {
  const rolls: number[] = [];
  let total = 0;

  const first = rng.d10();
  rolls.push(first);
  total += first;

  if (first === 10) {
    // Crítico: 1 dado extra, soma
    const extra = rng.d10();
    rolls.push(extra);
    total += extra;
  } else if (first === 1) {
    // Falha crítica: 1 dado extra, subtrai
    const extra = rng.d10();
    rolls.push(extra);
    total -= extra;
  }

  return { expression: `${rolls.length}d10`, rolls, total };
}

/** Resolve o contexto de ataque: arma, perícia, tipo, stat, nível. */
function resolveAttackContext(
  actor: CombatParticipant,
  action: AttackAction,
): {
  skillId: string;
  skill: { stat: AttributeName; level: number };
  attackType: string;
  baseStat: { id: AttributeName; value: number };
  weaponId?: string;
  /** Recorte do arma que as regras leem: munição, catálogo e (F1.8D.5) ROF. */
  weapon?: { ammo?: number; catalogItemId?: string; rateOfFire?: number; requiresTwoHands?: boolean };
  /** Base pronta de inimigo; personagens continuam usando STAT + nível. */
  attackBase?: number;
} {
  // Com arma: resolve da arma
  if (action.weaponId) {
    const weapon = actor.weapons?.find((w) => w.id === action.weaponId);
    if (!weapon) {
      throw new Error(`WEAPON_NOT_FOUND:${action.weaponId}`);
    }
    const skillId = weapon.skill;
    if (!skillId) {
      throw new Error("WEAPON_NO_SKILL");
    }
    const skill = actor.skills?.[skillId];
    if (!skill) {
      throw new Error(`SKILL_NOT_FOUND:${skillId}`);
    }
    const attackType = weapon.attackType ?? action.attackType;
    if (!attackType) {
      throw new Error("ATTACK_TYPE_MISSING");
    }
    const stat = skill.stat;
    const statValue = actor.stats?.[stat] ?? 0;
    return {
      skillId,
      skill: { stat, level: skill.level },
      attackType,
      baseStat: { id: stat, value: statValue },
      weaponId: action.weaponId,
      weapon: {
        ammo: weapon.ammo,
        catalogItemId: weapon.catalogItemId,
        // F1.8D.5: a ARMA é a fonte canônica do ROF — nunca a action.
        rateOfFire: weapon.rateOfFire,
        requiresTwoHands: weapon.requiresTwoHands,
      },
      ...(actor.type === "enemy" && Number.isFinite(weapon.attackBase)
        ? { attackBase: weapon.attackBase }
        : {}),
    };
  }

  // Sem arma: usa skillId da action
  const skillId = action.skillId;
  if (!skillId) {
    throw new Error("NO_WEAPON_NO_SKILL");
  }
  const skill = actor.skills?.[skillId];
  if (!skill) {
    throw new Error(`SKILL_NOT_FOUND:${skillId}`);
  }
  const attackType = action.attackType;
  if (!attackType) {
    throw new Error("ATTACK_TYPE_MISSING");
  }
  const stat = skill.stat;
  const statValue = actor.stats?.[stat] ?? 0;
  return {
    skillId,
    skill: { stat, level: skill.level },
    attackType,
    baseStat: { id: stat, value: statValue },
  };
}

/** Valida consistência attackType entre action e weapon. */
function validateAttackTypeConsistency(
  action: AttackAction,
  resolved: { attackType: string; weaponId?: string },
): { code: CombatErrorCode; message: string } | null {
  if (resolved.weaponId && action.attackType !== resolved.attackType) {
    return { code: "rule_violation", message: `attackType inconsistente: action=${action.attackType} vs weapon=${resolved.attackType}.` };
  }
  return null;
}

/** Calcula todos os modificadores de ataque na ordem canônica. */
function resolveAttackModifiers(
  actor: CombatParticipant,
  action: AttackAction,
  resolved: { skillId: string; attackType: string; weaponId?: string; weapon?: { catalogItemId?: string; requiresTwoHands?: boolean } },
): { total: number; modifiers: AttackModifier[] } {
  let total = 0;
  const modifiers: AttackModifier[] = [];

  const add = (source: string, value: number): void => {
    if (value === 0) return;
    total += value;
    modifiers.push({ source, value });
  };

  // 1. Wound penalty (reutiliza helper existente)
  const woundPenalty = getWoundPenalty({
    combat: actor.combat as unknown as import("@/types/character").CombatStats,
    cyberware: toCyberwareItems(actor.cyberware),
  });
  if (woundPenalty !== 0) {
    add("Wound penalty", woundPenalty);
  }

  // 2. Critical injury modifiers (reutiliza helper existente)
  const injuryMods = getCriticalInjuryModifiers({
    combat: actor.combat as unknown as import("@/types/character").CombatStats,
  });
  const isRanged = isRangedAttackType(resolved.attackType, resolved.skillId);
  add(isRanged ? "Critical injury (ranged)" : "Critical injury (melee)", isRanged ? injuryMods.rangedModifier : injuryMods.meleeModifier);
  add("Critical injury (physical)", injuryMods.allPhysicalModifier);
  add("Critical injury (actions)", injuryMods.allActionsModifier);
  add("Critical injury (area)", isRanged ? injuryMods.areaModifiers.arm : injuryMods.areaModifiers.leg);
  add("Critical injury (STAT)", injuryMods.statModifiers[actor.skills?.[resolved.skillId]?.stat ?? "REF"] ?? 0);
  const twoHandedSkillIds = new Set(["heavy_weapons", "shoulder_arms", "martial_arts", "melee_weapon", "brawling"]);
  if (twoHandedSkillIds.has(resolved.skillId)) add("Critical injury (two-handed)", injuryMods.twoHandedModifier);

  // 3. Cyberware modifiers (reutiliza helper existente)
  const isSmart = resolved.weapon?.catalogItemId
    ? isSmartWeapon(getCatalogItem(resolved.weapon.catalogItemId) ?? { subcategory: "", requires: undefined })
    : false;
  const cyberMods = getCyberwareAttackModifiers(
    { cyberware: toCyberwareItems(actor.cyberware) },
    { ranged: isRanged, smart: isSmart, skillId: resolved.skillId },
  );
  for (const mod of cyberMods) {
    add(mod.source, mod.value);
  }

  // 4. External modifiers (action.modifiers)
  for (const mod of action.modifiers ?? []) {
    add(mod.source, mod.value);
  }

  // 5. Aimed shot modifier (-8)
  if (action.attackMode === "aimed") {
    add("Aimed shot", -8);
  }

  return { total, modifiers };
}

/** Resolve a defesa: DV ou Evasion. */
/**
 * Modificadores PASSIVOS de Evasion — a parte que os DOIS contextos do
 * Combat Core compartilham de fato (F1.8D.10):
 *
 *   cyberware de Evasão (Kerenzikov/Sandevistan…) + lesão crítica
 *   (allPhysical + allActions + STAT da perícia)
 *
 * `statId` preserva a expressão EXATA de cada caminho: a defesa do ataque
 * (F1.8C) passa `"DEX"` fixo; o standalone (F1.8D.9) passa `skill.stat`. No
 * dado atual são o mesmo valor (`src/data/skills.ts:22`: evasion = DEX) e o
 * parâmetro mantém cada comportamento idêntico — refatorar não muda ninguém.
 *
 * O que NÃO entra aqui (divergências REAIS entre os caminhos, mantidas e
 * registradas no F1.8D.10): penalidade de lesão de HP, cyberware
 * `all_physical` e `action.modifiers` — só o standalone os aplica; a defesa
 * dentro do ataque é F1.8C e segue congelada. Igualar os totais seria
 * alterar uma regra fechada, não eliminar duplicação.
 *
 * Puro: só lê `target` (não muta state, participante, skills, cyberware nem
 * lesões) e não consome RNG.
 */
function evasionPassiveModifiers(target: CombatParticipant, statId: AttributeName): number {
  let total = 0;

  for (const modifier of getCyberwareEvasionModifiers({
    cyberware: toCyberwareItems(target.cyberware),
  })) {
    total += modifier.value;
  }

  const injuryMods = getCriticalInjuryModifiers({
    combat: target.combat as unknown as CombatStats,
  });
  total += injuryMods.allPhysicalModifier;
  total += injuryMods.allActionsModifier;
  total += injuryMods.statModifiers[statId] ?? 0;

  return total;
}

function resolveDefense(
  state: CombatState,
  action: AttackAction,
  target: CombatParticipant,
  rng: RandomSource,
): { defenseValue: number; defenseRoll?: DiceResult; defenseType: "dv" | "evasion" } {
  if (action.defense.type === "dv") {
    // DV: usa o valor fornecido pelo caller
    const dv = action.defense.value;
    if (!Number.isInteger(dv) || dv < 0) {
      throw new Error("INVALID_DV");
    }
    return { defenseValue: dv, defenseType: "dv" };
  }

  // Evasion: engine calcula DEX + Evasion skill + 1d10 + defensive modifiers
  const evasionSkill = target.skills?.["evasion"];
  if (!evasionSkill) {
    throw new Error("EVASION_SKILL_MISSING");
  }

  const dex = target.stats?.DEX ?? 0;
  const skillLevel = evasionSkill.level;

  // Roll de defesa (1d10)
  const defenseRoll = rollAttackDice(rng);

  // Modificadores defensivos (F1.8D.10): a parte PASSIVA que este caminho
  // compartilha com o standalone `EvasionAction` — cyberware de Evasão +
  // lesão crítica (allPhysical + allActions + STAT). NÃO inclui lesão de HP,
  // `all_physical` nem modifiers externos: a defesa dentro do ataque nunca os
  // teve (F1.8C congelado — divergência documentada, não "corrigida").
  const defenseModifier = evasionPassiveModifiers(target, "DEX");

  const defenseValue = dex + skillLevel + defenseRoll.total + defenseModifier;

  return { defenseValue, defenseRoll, defenseType: "evasion" };
}

/** Consome 1 munição da arma. Retorna o estado atualizado e a mudança. */
/**
 * Custo de munição do Autofire (F1.8D.6). É a ÚNICA regra de Autofire que o
 * projeto possui, com quatro fontes convergentes e nenhuma contradizendo:
 * `lib/attacks.ts:297` (`ammoCost = mode === "autofire" ... ? 10 : 1`), o
 * rótulo da UI (`AttackActions.tsx`: "10 ammo"), o contrato F1.0 §13 nº 7 e o
 * teste fechado `attack-mode-flow` (`INITIAL_AMMO - 10`).
 *
 * NÃO existe no projeto: DV/multiplicador de dano por balas, rolagens extras,
 * relação com ROF, defesa própria nem restrição de arma — esses ficam como
 * RULE GAP reportada na etapa, e por isso este custo é o único número que o
 * Autofire carrega para o motor.
 */
const AUTOFIRE_AMMO_COST = 10;

/**
 * Custo de munição do Suppressive Fire (F1.8D.7). Assim como o do Autofire,
 * é a ÚNICA regra de Suppressive que o projeto possui — quatro fontes
 * convergentes, todas EXPLÍCITAS para "suppressive": `lib/attacks.ts:297`
 * (`mode === "autofire" || mode === "suppressive" ? 10 : 1`), o rótulo da UI
 * (`AttackActions.tsx`: suppressive → "10 ammo"), o contrato F1.0 §13 nº 7
 * ("10 em autofire/suppressive, 1 no resto") e o teste fechado
 * `attack-mode-flow` (`["suppressive", INITIAL_AMMO - 10]`).
 *
 * NÃO existe no projeto, para Suppressive: exigência de ROF, quantidade de
 * tiros, área, múltiplos alvos, defesa própria, dano próprio, duração/
 * persistência ou interação com iniciativa — todos RULE GAP (F1.8D.7). Este
 * número é o único que o modo carrega para o motor.
 */
const SUPPRESSIVE_AMMO_COST = 10;

/**
 * Desconta `cost` balas da arma do ator no estado.
 *
 * `cost` vem do modo do ataque (F1.8D.6/F1.8D.7): 1 em normal/aimed, 10 em
 * autofire ou suppressive. Continua falhando com `NO_AMMO` quando a arma não
 * paga o custo — quem chama já validou antes da rolagem, então esse throw é a
 * segunda trava.
 */
function consumeAmmo(
  state: CombatState,
  actorId: string,
  weaponId: string,
  cost: 1 | 10,
): { state: CombatState; change: CombatStateChange | null } {
  const actor = state.participants.find((p) => p.id === actorId);
  const weapon = actor?.weapons?.find((w) => w.id === weaponId);
  if (!weapon || (weapon.ammo ?? 0) < cost) {
    throw new Error("NO_AMMO");
  }

  const before = weapon.ammo ?? 0;
  const after = before - cost;

  const participants = state.participants.map((participant) => {
    if (participant.id !== actorId) return participant;
    const weapons = participant.weapons?.map((w) =>
      w.id === weaponId ? { ...w, ammo: after } : w,
    );
    return { ...participant, weapons };
  });

  return {
    state: { ...state, participants },
    change: { type: "ammo_changed", participantId: actorId, weaponId, before, after },
  };
}

/**
 * Resolve uma ação de ataque canônica (F1.8C).
 *
 * Fluxo:
 *   validação → resolução de arma/perícia (da arma sai também o ROF, F1.8D.5)
 *   → modificadores → rolagem de ataque → resolução defensiva (DV/Evasion)
 *   → hit/miss → consumo de munição (custo do MODO: 1, ou 10 em
 *     Autofire/Suppressive) → AttackResult
 *
 * AUTOFIRE (F1.8D.6) e SUPPRESSIVE (F1.8D.7) não têm ramo próprio: entram
 * pelo mesmo caminho e o `attackMode` só decide `ammoCost`. Não existe alvo
 * extra, área, duração nem rolagem por alvo — isso seria RULE GAP, não regra.
 * Rolagens deles = rolagens do ataque normal (1d10 + defesa Evasion se for o
 * caso) — **zero** sorteios extras.
 */
function executeAttack(state: CombatState, action: AttackAction, rng: RandomSource): CombatResult {

  // ===== VALIDAÇÃO DO ATOR =====
  const actor = findParticipant(state, action.actorId);
  if (!actor) {
    return failure(state, "unknown_participant", `Ator ${action.actorId} não existe no combate.`);
  }
  if (actor.combat.isDead) {
    return failure(state, "combatant_defeated", `${actor.name} está fora do combate.`);
  }
  if (actor.combat.criticalInjuries.some((injury) => isCriticalInjuryUnconsciousAtRound(injury, state.round))) {
    return failure(state, "rule_violation", `${actor.name} está inconsciente e não pode realizar ações normais.`);
  }

  // ===== VALIDAÇÃO DO ALVO =====
  const target = findParticipant(state, action.targetId);
  if (!target) {
    return failure(state, "unknown_participant", `Alvo ${action.targetId} não existe no combate.`);
  }
  if (target.combat.isDead) {
    return failure(state, "combatant_defeated", `${target.name} está fora do combate.`);
  }

  // ===== VALIDAÇÃO DO attackMode =====
  // F1.8D.6/F1.8D.7: `autofire` e `suppressive` entram aqui — pelo MESMO
  // motor, sem laço, sem lista de alvos e sem rolagem própria (a única regra
  // de cada um no projeto é o custo de munição, no bloco abaixo). Qualquer
  // outro valor é recusado: o tipo não deixa passar, mas chamador JS pode
  // mandar qualquer string.
  if (
    action.attackMode !== "normal" &&
    action.attackMode !== "aimed" &&
    action.attackMode !== "autofire" &&
    action.attackMode !== "suppressive"
  ) {
    return failure(
      state,
      "rule_violation",
      `attackMode "${action.attackMode}" não é suportado pelo Combat Engine (só normal/aimed/autofire/suppressive).`,
    );
  }

  // ===== VALIDAÇÃO DO AIMED =====
  if (action.attackMode === "aimed" && !action.aimedTarget) {
    return failure(state, "rule_violation", "Aimed shot exige aimedTarget.");
  }
  if (action.attackMode === "aimed" && action.aimedTarget !== "head" && action.aimedTarget !== "leg" && action.aimedTarget !== "held_item") {
    return failure(state, "rule_violation", `Aimed target inválido: ${String(action.aimedTarget)}.`);
  }
  if (action.attackMode === "normal" && action.aimedTarget !== undefined) {
    return failure(state, "rule_violation", "Ataque normal não pode declarar aimedTarget.");
  }

  // ===== CUSTO DE MUNIÇÃO DO MODO (F1.8D.6/F1.8D.7) =====
  // Uma fonte só para a validação (abaixo) e para o consumo (no fim): 1 no
  // normal/aimed, 10 no Autofire e 10 no Suppressive — constantes SEPARADAS
  // de propósito: são duas regras com fontes próprias, não uma copiada da
  // outra; se o livro dizer que Suppressive custa outro valor, muda só a sua.
  // `attackMode` não entra em mais nada: rolagem, defesa, critical/fumble,
  // modificador −8 e dano continuam os de sempre (o legado é agnóstico ao
  // modo fora da munição — teste fechado: "só o custo de munição muda").
  const ammoCost: 1 | 10 =
    action.attackMode === "autofire"
      ? AUTOFIRE_AMMO_COST
      : action.attackMode === "suppressive"
        ? SUPPRESSIVE_AMMO_COST
        : 1;

  // ===== RESOLUÇÃO DE ARMA/PERÍCIA =====
  let resolved;
  try {
    resolved = resolveAttackContext(actor, action);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "RESOLVE_ERROR";
    return failure(state, "rule_violation", msg);
  }

  // ===== CONSISTÊNCIA attackType =====
  const typeError = validateAttackTypeConsistency(action, resolved);
  if (typeError) {
    return failure(state, typeError.code, typeError.message);
  }

  const restrictions = getCriticalInjuryRestrictions({
    combat: actor.combat as unknown as import("@/types/character").CombatStats,
  });
  if (
    restrictions.has("cannot_use_two_handed_weapons") &&
    (resolved.weapon?.requiresTwoHands === true || new Set(["heavy_weapons", "shoulder_arms", "martial_arts", "melee_weapon", "brawling"]).has(resolved.skillId))
  ) {
    return failure(state, "rule_violation", "Esta lesão impede o uso de armas ou ações que exigem as duas mãos.");
  }
  if (restrictions.has("cannot_use_lower_body") && ["melee", "martial_arts", "brawling", "unarmed"].includes(resolved.attackType)) {
    return failure(state, "rule_violation", "Esta lesão impede ataques corpo a corpo que dependem da parte inferior do corpo.");
  }

  // ===== VALIDAÇÃO DE ROF (F1.8D.5) =====
  // O ROF vem da ARMA resolvida (`weaponId → actor.weapons → rateOfFire`),
  // nunca da action — o contrato não tem `action.rof`, então o cliente não
  // pode declarar um valor diferente do cadastro. Ausente é legítimo (monowire
  // e granadas do catálogo não têm; o encontro achata a arma em escalares) e
  // NÃO é erro. Só valor PRESENTE e mal formado recusa — e recusa ANTES de
  // qualquer sorteio, sem consumir RNG nem mudar estado (mesma convenção do
  // F1.8D.2). Não há teto definido em lugar nenhum do projeto, então não se
  // inventa um.
  const rateOfFire = resolved.weapon?.rateOfFire;
  if (rateOfFire !== undefined && (!Number.isInteger(rateOfFire) || rateOfFire < 1)) {
    return failure(
      state,
      "rule_violation",
      `rateOfFire inválido em ${resolved.weaponId ?? resolved.skillId}: ${rateOfFire} (esperado inteiro ≥ 1).`,
    );
  }

  // ===== MODIFICADORES =====
  const resolvedModifiers = resolveAttackModifiers(actor, action, resolved);

  // ===== VALIDAÇÃO DE MUNIÇÃO =====
  // Custo pelo MODO (F1.8D.6): 1 em normal/aimed (F1.8C, inalterado) e 10 em
  // Autofire — a única regra de Autofire do projeto (4 fontes convergentes:
  // `attacks.ts:297`, rótulo da UI, F1.0 §13 nº 7, teste `attack-mode-flow`).
  // A recusa continua ANTES de qualquer sorteio: "não pode pagar" é a mesma
  // semântica do F1.8C (`ammo <= 0` = custo 1) generalizada para o custo do
  // modo — sem RNG consumido e sem estado novo.
  if (resolved.weaponId) {
    const weapon = actor.weapons?.find((w) => w.id === resolved.weaponId);
    const ammo = weapon?.ammo ?? 0;
    if (ammo < ammoCost) {
      return failure(
        state,
        "rule_violation",
        `Munição insuficiente para ${weapon?.name ?? resolved.weaponId} (precisa de ${ammoCost}, tem ${ammo}).`,
      );
    }
  }

  // ===== ROLAGEM DE ATAQUE =====
  const roll = rollAttackDice(rng);

  // ===== CÁLCULO DO TOTAL =====
  const attackBase = resolved.attackBase ?? (resolved.baseStat.value + resolved.skill.level);
  const attackTotal = attackBase + roll.total + resolvedModifiers.total;

  // ===== CRITICAL / FUMBLE =====
  const firstRoll = roll.rolls[0];
  const critical = firstRoll === 10;
  const fumble = firstRoll === 1;

  // ===== RESOLUÇÃO DEFENSIVA =====
  let defenseValue: number;
  let defenseRoll: DiceResult | undefined;
  let defenseType: "dv" | "evasion";

  try {
    const defense = resolveDefense(state, action, target, rng);
    defenseValue = defense.defenseValue;
    defenseRoll = defense.defenseRoll;
    defenseType = defense.defenseType;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "DEFENSE_ERROR";
    return failure(state, "rule_violation", msg);
  }

  // ===== HIT / MISS =====
  const hit = attackTotal > defenseValue;

  // ===== CONSUMO DE MUNIÇÃO =====
  let ammoChange: CombatStateChange | null = null;
  let finalState = state;

  if (resolved.weaponId) {
    try {
      const ammoResult = consumeAmmo(state, action.actorId, resolved.weaponId, ammoCost);
      finalState = ammoResult.state;
      ammoChange = ammoResult.change;
    } catch {
      return failure(state, "rule_violation", "Munição insuficiente.");
    }
  }

  // ===== CONSTRUIR AttackResult =====
  const attackResult: AttackResult = {
    attackId: `${action.actorId}-${action.targetId}-${Date.now()}`,
    attackType: resolved.attackType as AttackType,
    label: action.label ?? resolved.skillId,
    roll,
    baseStat: resolved.baseStat,
    skill: { id: resolved.skillId, value: resolved.skill.level },
    total: attackTotal,
    attackBase: resolved.attackBase,
    modifiers: resolvedModifiers.modifiers,
    critical,
    fumble,
    hit,
    defenseType,
    defenseValue,
    defenseRoll,
    aimedTarget: action.aimedTarget,
    // Custo do MODO (F1.8D.6): 1 em normal/aimed, 10 em autofire — pago
    // incondicionalmente, inclusive em miss e fumble, como sempre foi.
    ammoConsumed: ammoCost,
    weaponId: resolved.weaponId,
    // F1.8D.5: ROF resolvido da arma, transportado sem mecânica nenhuma —
    // ver o docblock do campo no contrato (RULE GAP para ROF > 1).
    rateOfFire,
  };

  // ===== CONSTRUIR CombatResult =====
  const rolls: CombatRoll[] = [
    {
      ...roll,
      kind: "attack",
      actorId: action.actorId,
      targetId: action.targetId,
    },
  ];
  if (defenseRoll) {
    rolls.push({
      ...defenseRoll,
      kind: "evasion",
      actorId: action.targetId,
      targetId: action.actorId,
    });
  }

  const changes: CombatStateChange[] = [];
  if (ammoChange) changes.push(ammoChange);

  return {
    ok: true,
    state: finalState,
    changes,
    rolls,
    events: [],
    attackResult,
  };
}

/**
 * Resolve uma ação de Evasão STANDALONE (F1.8D.9).
 *
 * Fórmula = a DETERMINADA da ficha (`rollEvasion`, `attacks.ts:317-377`) — a
 * rolagem que o projeto já faz hoje — montada com os mesmos helpers canônicos,
 * sem lógica copiada:
 *
 *   STAT(skill.stat) + nível + 1d10 + `action.modifiers`
 *   + penalidade de lesão (`getWoundPenalty` — fonte única, Pain Editor zera)
 *   + cyberware de Evasão (`getCyberwareEvasionModifiers`)
 *   + cyberware "todo físico" (`getCyberwarePhysicalModifiers`)
 *   + lesão crítica (`getCriticalInjuryModifiers`: allPhysical + allActions
 *     + STAT da perícia)
 *
 * Dados: o MESMO `rollAttackDice` do ataque — regra idêntica à da ficha
 * (primeiro 10 → 1 dado extra soma; primeiro 1 → 1 dado extra subtrai; sem
 * cadeia). Sorteio DEPOIS de toda validação: erro não consome RNG.
 *
 * O que esta ação NÃO faz (escopo/decisões da etapa):
 *  • não debita ação — na mesa a Evasão custa 1 (`MESA_ROLL_ACTION.evasion =
 *    "other"`), mas o débito é de `resolveAction`/`applyAction`; o motor não
 *    tem Action Economy (RULE GAP, dependência futura);
 *  • não muda estado nem gera evento — rolagem pura: `rolls` + `evasionResult`;
 *  • não se integra ao ataque — defender com `defense:{type:"evasion"}` segue
 *    resolvido dentro de `executeAttack`; os dois fluxos são separados;
 *  • não aplica condições (PRONE/etc.: §13 nº 10 do F1.0 — reportadas, não
 *    aplicadas) nem restrições de reuso/reção/Parry/Dodge-and-Dive: RULE GAP.
 *
 * Divergências PRÉ-EXISTENTES mantidas e documentadas (não unificadas aqui):
 *  • INIMIGO: a ficha usa DEX, o encontro usa REF + `evasionSkillLevel`
 *    (`combat/enemyAttacks.ts`) e o adapter não traz `skills.evasion` nem DEX
 *    para o inimigo (`adapters.ts:228-240`) → adaptado recusa com
 *    `EVASION_SKILL_MISSING`, sem default 0;
 *  • DEFESA dentro do ataque (F1.8C, `resolveDefense`): a parte PASSIVA já é
 *    compartilhada (`evasionPassiveModifiers`, F1.8D.10), mas ela não soma
 *    lesão de HP, `all_physical` nem `action.modifiers` — termos exclusivos
 *    deste standalone; o F1.8C segue congelado;
 *  • DADO do inimigo legado encadeia o 10 (laço `while`); o da ficha e o do
 *    motor dão UM extra só.
 */
function executeEvasion(state: CombatState, action: EvasionAction, rng: RandomSource): CombatResult {
  // ===== VALIDAÇÕES — mesmos códigos e direção do caminho de dano (F1.8D.1) =====
  if (state.status === "finished") {
    return failure(state, "combat_finished", "Combate encerrado: ação não aceita.");
  }

  const actor = findParticipant(state, action.actorId);
  if (!actor) {
    return failure(state, "unknown_participant", `Ator ${action.actorId} não existe no combate.`);
  }
  if (actor.combat.isDead) {
    return failure(state, "combatant_defeated", `${actor.name} está fora do combate.`);
  }

  // Perícia exigida — mesmo código da defesa-Evasão do F1.8C. Ausência é
  // recusa honesta (o recorte do encontro não traz `skills.evasion`); o STAT
  // também: nunca `?? 0` escondendo dado faltante (F1.8D.9 §10).
  const skill = actor.skills?.["evasion"];
  if (!skill) {
    return failure(state, "rule_violation", "EVASION_SKILL_MISSING");
  }
  const statValue = actor.stats?.[skill.stat];
  if (typeof statValue !== "number") {
    return failure(state, "rule_violation", `EVASION_STAT_MISSING:${skill.stat}`);
  }

  // ===== MODIFICADORES — fórmula da ficha, só helpers canônicos =====
  // Externos (SÓ neste caminho): modifiers do chamador, lesão de HP e
  // cyberware "todo físico". A parte PASSIVA (cyberware de Evasão + lesão
  // crítica) vem do resolvedor compartilhado com a defesa do ataque
  // (F1.8D.10) — a ordem dos termos não altera a soma inteira.
  const cyberware = { cyberware: toCyberwareItems(actor.cyberware) };
  const combatStats = actor.combat as unknown as CombatStats;

  let modifierTotal = 0;
  for (const modifier of action.modifiers ?? []) {
    modifierTotal += modifier.value;
  }
  modifierTotal += getWoundPenalty({ combat: combatStats, cyberware: cyberware.cyberware });
  for (const modifier of getCyberwarePhysicalModifiers(cyberware)) {
    modifierTotal += modifier.value;
  }
  modifierTotal += evasionPassiveModifiers(actor, skill.stat);

  // ===== ROLAGEM — só depois de validado tudo =====
  const roll = rollAttackDice(rng);
  const critical = roll.rolls[0] === 10;
  const fumble = roll.rolls[0] === 1;
  const total = statValue + skill.level + roll.total + modifierTotal;

  const evasionResult: EvasionResult = {
    roll,
    baseStat: { id: skill.stat, value: statValue },
    skill: { id: "evasion", value: skill.level },
    total,
    critical,
    fumble,
  };

  return {
    ok: true,
    // Estado intacto: a ação não tem efeito persistente nenhum.
    state,
    changes: [],
    rolls: [{ ...roll, kind: "evasion", actorId: action.actorId }],
    events: [],
    evasionResult,
  };
}
