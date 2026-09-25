import { rollAttack } from "@/lib/attacks";
import { rollSkillCheck } from "@/lib/skills";
import { getMartialArtsPoints, type MartialArtsPoints } from "@/lib/progression";
import { MARTIAL_ARTS_FORMS, skillDefinitions, type MartialArtForm } from "@/data/skills";
import { SPECIAL_MOVES, type SpecialMove, type SpecialMoveRequirement } from "@/data/specialMoves";
import type { AttackRollResult } from "@/types/attack";
import type { Character, RollHistoryEntry } from "@/types/character";

/** Estado do turno, marcado à mão no Card 03 (o app não tem contador de rodada — ver PENDENCIAS.md).
 * Parte dele é atualizada sozinha quando você rola um ataque (acertou com Brawling / Artes Marciais / arma branca). */
export interface TurnState {
  /** Metros percorridos neste turno. */
  movedMeters: number;
  /** Melee Attacks acertados neste turno. */
  meleeHits: number;
  /** Está agarrando um alvo. */
  grabbingTarget: boolean;
  /** Esquivou de todos os Melee Attacks desde o último turno. */
  dodgedAllMelee: boolean;
  hitBrawling: boolean;
  hitMartialArts: boolean;
}

export const DEFAULT_TURN_STATE: TurnState = {
  movedMeters: 0,
  meleeHits: 0,
  grabbingTarget: false,
  dodgedAllMelee: false,
  hitBrawling: false,
  hitMartialArts: false,
};

/** Perícia de Artes Marciais que o personagem vai usar. */
export interface MartialArtsSkillRef {
  skillId: string;
  name: string;
  level: number;
}

function formSkillName(form: MartialArtForm): string | undefined {
  const entry = MARTIAL_ARTS_FORMS.find((candidate) => candidate.form === form);
  if (!entry) return undefined;
  return skillDefinitions[entry.skillId]?.name;
}

/** Melhor perícia de Artes Marciais do personagem (formas primeiro, depois a genérica).
 * Usada pelos moves compartilhados, como o Recovery. */
export function getBestMartialArtsSkill(character: Pick<Character, "skills">): MartialArtsSkillRef | undefined {
  const candidates: MartialArtsSkillRef[] = [];
  for (const { skillId } of MARTIAL_ARTS_FORMS) {
    const skill = character.skills[skillId];
    if (skill && skill.level > 0) candidates.push({ skillId, name: skill.name, level: skill.level });
  }
  // A perícia genérica só entra quando não há nenhuma forma treinada (regra:
  // para usar Artes Marciais é preciso ao menos 1 ponto numa forma).
  if (candidates.length === 0) {
    const generic = character.skills.martial_arts;
    if (generic && generic.level > 0) candidates.push({ skillId: "martial_arts", name: generic.name, level: generic.level });
  }
  return candidates.sort((a, b) => b.level - a.level)[0];
}

/** Perícia que o move usa: a própria forma (nunca some formas), ou a melhor para moves compartilhados. */
export function resolveSkillForMove(character: Pick<Character, "skills">, move: SpecialMove): MartialArtsSkillRef | undefined {
  if (move.form === "shared") return getBestMartialArtsSkill(character);
  const entry = MARTIAL_ARTS_FORMS.find((candidate) => candidate.form === move.form);
  if (!entry) return undefined;
  const skill = character.skills[entry.skillId];
  return skill && skill.level > 0 ? { skillId: entry.skillId, name: skill.name, level: skill.level } : undefined;
}

function unlockedMoveIds(character: Pick<Character, "unlockedSpecialMoves">): string[] {
  return character.unlockedSpecialMoves ?? [];
}

/** Desbloqueio sai do bolso único de Martial Arts (`getMartialArtsPoints`): os níveis da
 * perícia-mãe geram 1 ponto cada, e o mesmo bolso paga especialização e Special Move. */
export function getSpecialMovePoints(character: Pick<Character, "skills" | "unlockedSpecialMoves">): MartialArtsPoints {
  return getMartialArtsPoints(character);
}

/** Paga 1 ponto de Martial Arts para desbloquear o move (permanente, fica na ficha).
 * Ainda exige ≥1 ponto na especialização daquele move. */
export function unlockSpecialMove(character: Character, move: SpecialMove): Character | null {
  const unlocked = unlockedMoveIds(character);
  if (unlocked.includes(move.id)) return null;
  if (!resolveSkillForMove(character, move)) return null;
  if (getMartialArtsPoints(character).free <= 0) return null;
  return { ...character, unlockedSpecialMoves: [...unlocked, move.id] };
}

/** Devolve o ponto do desbloqueio (corrige gasto errado). */
export function refundSpecialMove(character: Character, move: SpecialMove): Character | null {
  const unlocked = unlockedMoveIds(character);
  if (!unlocked.includes(move.id)) return null;
  return { ...character, unlockedSpecialMoves: unlocked.filter((id) => id !== move.id) };
}

function checkRequirement(requirement: SpecialMoveRequirement, character: Character, turnState: TurnState): string | undefined {
  switch (requirement.type) {
    case "stat_min":
      return character.stats[requirement.stat] >= requirement.value ? undefined : requirement.label;
    case "move_min":
      return character.stats.MOVE >= requirement.value ? undefined : requirement.label;
    case "turn_flag":
      return turnState[requirement.flag] ? undefined : requirement.label;
    case "turn_counter":
      return turnState[requirement.flag] >= requirement.value ? undefined : requirement.label;
  }
}

export interface SpecialMoveAvailability {
  move: SpecialMove;
  /** Perícia que será usada; undefined quando o personagem não tem ponto na forma. */
  skill?: MartialArtsSkillRef;
  /** Bolso único de pontos de Martial Arts (especialização + desbloqueio). */
  points: MartialArtsPoints;
  /** O move já foi pago com 1 ponto e está gravado na ficha. */
  unlocked: boolean;
  /** Dá para pagar o desbloqueio agora: tem especialização e ponto livre. */
  canUnlock: boolean;
  available: boolean;
  /** Motivos em texto para o botão ficar desabilitado (exibidos na ficha). */
  missing: string[];
}

/** Valida automaticamente os requisitos do move: perícia da forma, atributos e flags do turno.
 * O desbloqueio (1 ponto de Martial Arts) é uma trava separada de `available`: move pago pode
 * ficar bloqueado no turno, e move com requisito ok pode continuar travado por falta de ponto. */
export function getSpecialMoveAvailability(
  character: Character,
  turnState: TurnState,
  move: SpecialMove,
): SpecialMoveAvailability {
  const skill = resolveSkillForMove(character, move);
  const points = getMartialArtsPoints(character);
  const unlocked = unlockedMoveIds(character).includes(move.id);
  const missing: string[] = [];
  if (!skill) {
    missing.push(
      move.form === "shared"
        ? "1 ponto em alguma forma de Martial Arts"
        : `1 ponto em ${formSkillName(move.form) ?? "a forma correspondente"}`,
    );
  }
  for (const requirement of move.requirements) {
    const problem = checkRequirement(requirement, character, turnState);
    if (problem) missing.push(problem);
  }
  return {
    move,
    skill,
    points,
    unlocked,
    canUnlock: !unlocked && Boolean(skill) && points.free > 0,
    available: unlocked && missing.length === 0,
    missing,
  };
}

export function listSpecialMoveAvailability(character: Character, turnState: TurnState): SpecialMoveAvailability[] {
  return SPECIAL_MOVES.map((move) => getSpecialMoveAvailability(character, turnState, move));
}

export type SpecialMoveResolution =
  | { kind: "check"; move: SpecialMove; skill: MartialArtsSkillRef; total: number; dv: number; success: boolean; character: Character }
  | { kind: "attack"; move: SpecialMove; skill: MartialArtsSkillRef; attack: AttackRollResult; character: Character }
  | { kind: "passive"; move: SpecialMove; skill: MartialArtsSkillRef; character: Character };

/** Executa o Special Move:
 * `check` = rolagem de perícia da forma vs DV do JSON · `attack` = ataque normal de Artes Marciais
 * (entra no fluxo de dano da ficha, com o piso/metade de SP) · `passive` = só confirma disponibilidade. */
export function resolveSpecialMove(
  character: Character,
  move: SpecialMove,
  turnState: TurnState,
  options: { headAim?: boolean } = {},
): SpecialMoveResolution | { error: string } {
  const availability = getSpecialMoveAvailability(character, turnState, move);
  if (!availability.unlocked) {
    const points = availability.points;
    const free = points.free;
    if (!availability.skill) {
      return { error: `Special Move travado: "${move.name}" precisa de 1 ponto na especialização correspondente.` };
    }
    return {
      error: `Special Move travado: desbloqueie "${move.name}" com 1 ponto de Martial Arts (${free} livre${free === 1 ? "" : "s"} de ${points.total}; ${points.spentSpecializations} em especializações e ${points.spentMoves} em moves).`,
    };
  }
  if (!availability.available) return { error: `Requisito não atendido: ${availability.missing.join("; ")}.` };
  const skill = availability.skill!;
  if (move.kind === "passive") return { kind: "passive", move, skill, character };

  if (move.kind === "check") {
    const outcome = rollSkillCheck(character, skill.skillId);
    if ("error" in outcome) return outcome;
    const dv = move.dv ?? 15;
    const total = outcome.result.total;
    const success = total >= dv;
    const [top, ...rest] = outcome.character.rollHistory;
    if (!top) return { kind: "check", move, skill, total, dv, success, character: outcome.character };
    const entry: RollHistoryEntry = {
      ...top,
      label: `Special Move: ${move.name}`,
      expression: `${top.expression} · vs DV ${dv} → ${success ? "SUCESSO" : "FALHA"}`,
    };
    return { kind: "check", move, skill, total, dv, success, character: { ...outcome.character, rollHistory: [entry, ...rest] } };
  }

  // Ataque: o move substitui os ataques normais e causa o dano normal de Artes Marciais.
  const outcome = rollAttack(character, {
    type: "martial_arts",
    skillId: skill.skillId,
    label: move.name,
    modifiers: options.headAim ? [{ source: "Mira na cabeça", value: -8 }] : [],
  });
  if ("error" in outcome) return outcome;
  return { kind: "attack", move, skill, attack: outcome.result, character: outcome.character };
}

export { type MartialArtsPoints } from "@/lib/progression";
