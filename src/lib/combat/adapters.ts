/**
 * F1.1 — ADAPTERS para `CombatParticipant`.
 *
 * São **duas transformações de dados**, nada mais:
 *
 *     Character ──────────────► CombatParticipant
 *     EncounterParticipant ───► CombatParticipant
 *
 * Aqui NÃO existe rolagem, dano, cura, recarga, cálculo de iniciativa,
 * penalidade de ferimento, lesão crítica, custo de ação ou qualquer mutação da
 * origem — `dados → mapeamento → dados`. As regras ficam nos módulos de regra
 * e entram no motor em F1.2+.
 *
 * F1.5: os dois adapters passam a copiar também o SP de cyberware do local
 * (`cyberwareSP`), que já era derivado do dado instalado — sem ele o motor
 * aplicaria dano com a proteção errada (Subdermal Armor/Skin Weave ignorada).
 * Continua sendo leitura de dado, não regra de combate.
 *
 * F1.7 (Parte B): para o contrato de `attack`, os dois adapters preservam
 * também os DADOS que o ataque lê, sem calcular nada:
 *   • `skills` do encontro — a perícia da arma com o nível puro recuperado
 *     de `skillValue` (= REF + nível; inversão exata, ver
 *     `encounterWeaponSkills`);
 *   • `cyberware` — peças instaladas no recorte mínimo que as regras de
 *     efeitos leem (`CombatCyberwareItem`), pelo mesmo caminho de sempre;
 *   • `attackBase` do encontro — a base pronta que
 *     `combat/enemyAttacks.ts` soma hoje.
 * Nenhum bônus, modificador ou total de ataque é calculado aqui: o adapter
 * segue sendo `dados → mapeamento → dados`.
 *
 * Os dois contextos continuam sendo o que sempre foram: nenhum consumidor
 * (`CharacterSheet`, `AttackActions`, `EncountersPageClient`, `gmStorage`,
 * Mesa/Supabase) foi migrado para `CombatParticipant` nesta etapa.
 */
import type { Character, CyberwareItem, Weapon } from "@/types/character";
import type { EncounterParticipant } from "@/lib/gmStorage";
import { getCyberwareBodySP } from "@/lib/cyberwareEffects";
import { enemyCyberwareView, getEnemyBodySP } from "@/lib/enemyCyberware";
import type {
  CombatCyberwareItem,
  CombatParticipant,
  CombatSkill,
  CombatSource,
  CombatWeapon,
} from "@/lib/combat/contract";
import type { AttackType } from "@/types/attack";

/**
 * `EncounterParticipant.id` continua opcional no tipo original porque fichas
 * antigas não tinham (o `id` nasce no `crypto.randomUUID()` de
 * `ensureEncounterIds`, `src/lib/gmStorage.ts:385`).
 *
 * O adapter **exige a entidade já normalizada** — ele não gera chave nenhuma:
 * a geração existente continua sendo a fonte da verdade (F0.4/F0.5). A
 * assinatura já impõe isso em tempo de compilação; a checagem embaixo cobre
 * chamada vinda de JS/JSON legado.
 */
export type NormalizedEncounterParticipant = EncounterParticipant & { id: string };

/** Cópia só das chaves definidas: no contrato, "campo ausente" ≠ `undefined`. */
function pickDefined<T extends object>(source: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(source) as Array<keyof T>) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function toCombatWeapon(weapon: Weapon): CombatWeapon {
  return {
    id: weapon.id,
    name: weapon.name,
    damage: weapon.damage,
    ...pickDefined({
      skill: weapon.skill,
      attackType: weapon.attackType,
      rateOfFire: weapon.rateOfFire,
      magazine: weapon.magazine,
      ammo: weapon.ammo,
      catalogItemId: weapon.catalogItemId,
      requiresTwoHands: weapon.requiresTwoHands,
    }),
  };
}

function characterSkills(character: Character): Record<string, CombatSkill> {
  const skills: Record<string, CombatSkill> = {};
  for (const [skillId, skill] of Object.entries(character.skills)) {
    skills[skillId] = { stat: skill.stat, level: skill.level };
  }
  return skills;
}

/** Peça da ficha → recorte mínimo do contrato (F1.7 Gap 2): só o que as regras de efeitos leem. */
function toCombatCyberware(item: CyberwareItem): CombatCyberwareItem {
  return {
    name: item.name,
    ...pickDefined({ catalogItemId: item.catalogItemId, activeStage: item.activeStage }),
  };
}

/**
 * Cyberware da ficha: cópia das peças instaladas, sem efeito calculado.
 * Lista vazia = campo ausente (sem bônus inventado para quem não tem nada).
 */
function characterCyberware(character: Character): CombatCyberwareItem[] | undefined {
  if (character.cyberware.length === 0) return undefined;
  return character.cyberware.map(toCombatCyberware);
}

function fromCharacter(character: Character): CombatParticipant {
  const source: CombatSource = {
    characterId: character.id,
    sourceKey: null,
    enemyId: null,
  };
  const cyberware = characterCyberware(character);

  return {
    id: character.id,
    type: "character",
    name: character.identity.name,
    source,
    stats: { ...character.stats },
    skills: characterSkills(character),
    weapons: character.weapons.map(toCombatWeapon),
    ...(cyberware ? { cyberware } : {}),
    combat: {
      hp: { ...character.combat.hp },
      armor: { ...character.combat.armor },
      // SP de cyberware por local (F1.5): só o corpo tem (Subdermal/Skin
      // Weave) — leitura do cyberware instalado, mesma regra de
      // `getEffectiveArmorSP`; sem isto o motor degradaria o SP errado.
      cyberwareSP: { head: 0, body: getCyberwareBodySP(character) },
      criticalInjuries: [...character.combat.criticalInjuries],
      // A ficha não tem estado de condição — lista vazia é "nenhuma", não
      // "inventei uma condição padrão".
      conditions: [],
      deathSave: {
        dc: character.combat.deathSaveDC,
        failures: character.combat.deathSaveFailures,
      },
      // A ficha não persiste iniciativa (só o histórico da rolagem).
      initiative: null,
      isDead: character.combat.isDead,
    },
    // Sem economia: orçamento de Actions/movimento é da MESA, não da ficha.
  };
}

/**
 * Deriva o "morto" de um inimigo a partir do HP.
 *
 * `EncounterParticipant` não tem flag de morte, e o MESMO critério já roda no
 * servidor para a mesa (`update.is_dead = clamped <= 0`,
 * `src/lib/mesa/store.ts:1477`) e no `CombatantView.isDead` que alimenta
 * `resolveAction`. Não é regra nova: é projeção do critério existente —
 * inimigo não tem death save (divergência F1.0 nº 3).
 */
function encounterIsDead(hp: { current: number; max: number }): boolean {
  return hp.current <= 0;
}

/**
 * F1.7 Gap 1 — perícia da ARMA do encontro com o NÍVEL PURO.
 *
 * O encontro grava a combinação `skillValue = refStat + skillLevel`
 * (montada em `gmStorage` ao criar o participante) e guarda o REF usado ao
 * lado (`refStat`). Subtrair um do outro é a inversão EXATA dessa
 * combinação — o invariante `REF + nível === skillValue` é testado em
 * `tests/combat-attack-data.test.ts`. Não é a conta de ataque de ninguém
 * reimplementada: é o nível que a origem já tinha somado.
 *
 * O `stat` é `REF` porque foi com ele que a origem montou o `skillValue`.
 * O bestiário canônico usa o STAT da própria perícia (`enemyRolls.ts`),
 * e essa divergência fica documentada no relatório F1.7 §3 — sem correção
 * aqui (F1.7 §10: regras não mudam).
 *
 * Sem dado utilizável (id vazio, número não inteiro, nível negativo) não se
 * inventa skill nenhuma: o campo fica ausente e o participante continua
 * representável.
 */
function encounterWeaponSkills(
  participant: NormalizedEncounterParticipant,
): Record<string, CombatSkill> | undefined {
  const skillId = participant.weaponSkillId;
  if (typeof skillId !== "string" || skillId.length === 0) return undefined;
  const { skillValue, refStat } = participant;
  if (!Number.isInteger(skillValue) || !Number.isInteger(refStat)) return undefined;
  const level = skillValue - refStat;
  if (level < 0) return undefined;
  return { [skillId]: { stat: "REF", level } };
}

/** Dados defensivos materializados do bestiário; ausência permanece ausência. */
function encounterDefensiveSkills(
  participant: NormalizedEncounterParticipant,
): Record<string, CombatSkill> | undefined {
  const level = participant.evasionSkillLevel;
  const stat = participant.evasionSkillStat;
  if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || typeof stat !== "string") {
    return undefined;
  }
  return { evasion: { stat, level } };
}

/**
 * F1.7 Gap 2 — implantes no recorte mínimo do contrato, pela MESMA projeção
 * de sempre (`enemyCyberwareView`: nomes → peças com o primeiro estágio
 * ligado, política do Mestre de 30/09/2026). O adapter copia DADO — nenhum
 * bônus de ataque é calculado aqui; quem soma modificadores é a regra
 * canônica, uma única vez. Lista vazia/ausente = campo ausente.
 */
function encounterCyberware(implants?: string[] | null): CombatCyberwareItem[] | undefined {
  const cyberware = enemyCyberwareView(implants).cyberware;
  if (cyberware.length === 0) return undefined;
  return cyberware.map((item) => ({
    name: item.name,
    ...pickDefined({ activeStage: item.activeStage }),
  }));
}

/** Mapeamento de categoria já existente no bestiário para o contrato do Engine. */
function encounterAttackType(type?: NormalizedEncounterParticipant["weaponAttackType"]): AttackType | undefined {
  if (type === "melee") return "melee";
  if (type === "thrown") return "thrown_weapon";
  if (type === "ranged") return "weapon";
  return undefined;
}

function fromEncounterParticipant(
  participant: NormalizedEncounterParticipant,
): CombatParticipant {
  if (participant.id.length === 0) {
    throw new Error(
      "toCombatParticipant: participante sem id de instância. " +
        "Normalize antes com ensureEncounterIds() (src/lib/gmStorage.ts:385).",
    );
  }

  // `enemyId` (template) e `id` (instância) seguem SEPARADOS: o adapter nunca
  // promove o template a identidade — F0.4/F0.5.
  const source: CombatSource = {
    characterId: null,
    sourceKey: participant.id,
    enemyId: participant.enemyId,
  };

  const stats = pickDefined({ REF: participant.refStat, DEX: participant.dexStat, MOVE: participant.moveStat });
  const weaponSkills = encounterWeaponSkills(participant);
  const defensiveSkills = encounterDefensiveSkills(participant);
  const skills = weaponSkills || defensiveSkills
    ? { ...weaponSkills, ...defensiveSkills }
    : undefined;
  const cyberware = encounterCyberware(participant.implants);

  return {
    id: participant.id,
    type: participant.isPlayer ? "character" : "enemy",
    name: participant.name,
    source,
    stats,
    // F1.7: a PERÍCIA DA ARMA com o nível puro recuperado do `skillValue`
    // — ver `encounterWeaponSkills` (fecha a pendência §6 do F1.1).
    ...(skills ? { skills } : {}),
      weapons: [
        {
        ...(participant.weaponId ? { id: participant.weaponId } : {}),
        name: participant.weaponName,
        damage: participant.damageExpression,
        skill: participant.weaponSkillId,
        // Armas do inimigo usam o mesmo catálogo de armas do Player. O id do
        // participante é a referência canônica quando o encontro não tem um
        // campo separado de catalogItemId.
        ...(participant.weaponId ? { catalogItemId: participant.weaponId } : {}),
        ...pickDefined({ attackType: encounterAttackType(participant.weaponAttackType), rateOfFire: participant.weaponRateOfFire, requiresTwoHands: participant.requiresTwoHands }),
        // Base pronta do encontro (F1.7): é o número que
        // `combat/enemyAttacks.ts` soma hoje (`p.attackBase`); a ficha não
        // tem equivalente (`Weapon` não possui `attackBase`).
        ...(Number.isFinite(participant.attackBase)
          ? { attackBase: participant.attackBase }
          : {}),
        ...pickDefined({ magazine: participant.magazine, ammo: participant.ammo }),
      },
    ],
    // Cyberware dos implantes, dado bruto no mínimo que as regras leem.
    ...(cyberware ? { cyberware } : {}),
    combat: {
      hp: { ...participant.hp },
      armor: { ...participant.armor },
      // SP de cyberware por local (F1.5): implantes do encontro, mesma regra
      // de `getParticipantArmorSP` — cabeça sempre 0.
      cyberwareSP: { head: 0, body: getEnemyBodySP(participant.implants) },
      // O encontro não rastreia lesões críticas do inimigo (o campo não existe
      // mais: o encontro preserva a mesma lista do Player.
      criticalInjuries: [...(participant.criticalInjuries ?? [])],
      conditions: participant.conditions.map((condition) => ({ ...condition })),
      // Sem death save: inimigo/NPC não rola (divergência F1.0 nº 1).
      initiative: participant.initiative,
      isDead: encounterIsDead(participant.hp),
    },
    // Sem economia: o orçamento de Actions é da mesa, não do participante.
  };
}

function isCharacter(
  source: Character | NormalizedEncounterParticipant,
): source is Character {
  return "schemaVersion" in source;
}

/** `Character` → `CombatParticipant` (só mapeamento). */
export function toCombatParticipant(character: Character): CombatParticipant;
/** `EncounterParticipant` **já normalizado** → `CombatParticipant` (só mapeamento). */
export function toCombatParticipant(
  participant: NormalizedEncounterParticipant,
): CombatParticipant;
export function toCombatParticipant(
  source: Character | NormalizedEncounterParticipant,
): CombatParticipant {
  return isCharacter(source) ? fromCharacter(source) : fromEncounterParticipant(source);
}
