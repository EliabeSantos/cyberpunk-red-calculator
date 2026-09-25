import type { MartialArtForm } from "@/data/skills";
import type { AttributeName } from "@/types/character";

/** Requisito estruturado: é ele que permite validar o Special Move antes de liberar o botão. */
export type SpecialMoveRequirement =
  | { type: "stat_min"; stat: AttributeName; value: number; label: string }
  | { type: "move_min"; value: number; label: string }
  | { type: "turn_flag"; flag: TurnFlag; label: string }
  | { type: "turn_counter"; flag: TurnCounterFlag; value: number; label: string };

/** Estado de turno marcado manualmente no Card 03 (o app não tem contador de rodada). */
export type TurnFlag = "grabbingTarget" | "dodgedAllMelee" | "hitBrawling" | "hitMartialArts";
export type TurnCounterFlag = "movedMeters" | "meleeHits";

/** Como o move é resolvido:
 * `check` = rolagem contra um DV do JSON · `attack` = ataque de Artes Marciais normal
 * (entra no fluxo de dano da ficha) · `passive` = sem rolagem, só disponibilidade. */
export type SpecialMoveKind = "check" | "attack" | "passive";

export interface SpecialMove {
  id: string;
  name: string;
  /** Forma que fornece a perícia; "shared" usa a melhor forma do personagem. */
  form: MartialArtForm | "shared";
  /** Requisito como está no material original. */
  requirement: string;
  /** Efeito como está no material original. */
  effect: string;
  kind: SpecialMoveKind;
  /** DV da resolução, quando o material define um. */
  dv?: number;
  /** Permite mirar a cabeça com −8 no teste (mata o efeito de cabeça correspondente). */
  headAim?: boolean;
  /** Efeito relatado ao acertar (o alvo é externo à ficha do jogador). */
  outcome?: string;
  requirements: SpecialMoveRequirement[];
}

/** JSON original recebido — requisitos e efeitos preservados literalmente. */
export const SPECIAL_MOVES: SpecialMove[] = [
  {
    id: "recovery",
    name: "Recovery",
    form: "shared",
    requirement: "Nenhum",
    effect: "Ao usar Get Up, faça uma resolução DV13. Sucesso: Get Up não consome Action.",
    kind: "check",
    dv: 13,
    requirements: [],
  },
  {
    id: "disarming_combination",
    name: "Disarming Combination",
    form: "aikido",
    requirement: "Acertar o mesmo alvo com Brawling e Martial Arts no mesmo Turno.",
    effect: "DV15. Sucesso: toma um objeto das mãos do alvo ou faz o objeto cair.",
    kind: "check",
    dv: 15,
    outcome: "Desarmar o alvo: objeto tomado ou derrubado.",
    requirements: [
      { type: "turn_flag", flag: "hitBrawling", label: "acertar com Brawling neste turno" },
      { type: "turn_flag", flag: "hitMartialArts", label: "acertar com Martial Arts neste turno" },
    ],
  },
  {
    id: "iron_grip",
    name: "Iron Grip",
    form: "aikido",
    requirement: "Estar agarrando o alvo.",
    effect: "Aumenta a penalidade do alvo agarrado para -4 e impede o uso de armas de ataque à distância.",
    kind: "passive",
    outcome: "Alvo agarrado: penalidade −4 e sem armas à distância.",
    requirements: [{ type: "turn_flag", flag: "grabbingTarget", label: "estar agarrando o alvo" }],
  },
  {
    id: "armor_breaking_combination",
    name: "Armor Breaking Combination",
    form: "karate",
    requirement: "Acertar o mesmo alvo com Melee Weapon e Martial Arts no mesmo Turno.",
    effect: "DV15. Sucesso: o alvo sofre 2 pontos adicionais de ablação na armadura.",
    kind: "check",
    dv: 15,
    outcome: "Alvo: +2 pontos de ablação na armadura.",
    requirements: [
      { type: "turn_counter", flag: "meleeHits", value: 1, label: "acertar com Melee Weapon neste turno" },
      { type: "turn_flag", flag: "hitMartialArts", label: "acertar com Martial Arts neste turno" },
    ],
  },
  {
    id: "bone_breaking_strike",
    name: "Bone Breaking Strike",
    form: "karate",
    requirement: "WILL 8+.",
    effect: "Substitui os 2 ataques da Attack Action. Sucesso: causa dano normal + Broken Ribs. Com -8 no teste, pode mirar a cabeça e causar Cracked Skull.",
    kind: "attack",
    headAim: true,
    outcome: "Sucesso: dano normal de Artes Marciais + Broken Ribs (ou Cracked Skull mirando a cabeça com −8).",
    requirements: [{ type: "stat_min", stat: "WILL", value: 8, label: "WILL 8+" }],
  },
  {
    id: "counter_throw",
    name: "Counter Throw",
    form: "judo",
    requirement: "Ter esquivado de todos os Melee Attacks direcionados a você desde seu último Turno.",
    effect: "DV15. Sucesso: usa Throw no alvo cujo ataque foi esquivado. O Throw não pode ser evitado.",
    kind: "check",
    dv: 15,
    outcome: "Throw no alvo esquivado, sem como evitar.",
    requirements: [{ type: "turn_flag", flag: "dodgedAllMelee", label: "esquivar de todos os Melee Attacks desde o último turno" }],
  },
  {
    id: "grab_escape",
    name: "Grab Escape",
    form: "judo",
    requirement: "Acertar 2 Melee Attacks contra quem está agarrando você no mesmo Turno.",
    effect: "DV15. Sucesso: escapa do Grapple e causa Broken Arm.",
    kind: "check",
    dv: 15,
    outcome: "Escapa do Grapple e causa Broken Arm no agarrador.",
    requirements: [{ type: "turn_counter", flag: "meleeHits", value: 2, label: "acertar 2 Melee Attacks neste turno" }],
  },
  {
    id: "pressure_point_strike",
    name: "Pressure Point Strike",
    form: "taekwondo",
    requirement: "WILL 8+.",
    effect: "Substitui os 2 ataques da Attack Action. Sucesso: causa dano normal + Spinal Injury. Com -8 no teste, pode causar Brain Injury.",
    kind: "attack",
    outcome: "Sucesso: dano normal de Artes Marciais + Spinal Injury (ou Brain Injury com −8 no teste).",
    requirements: [{ type: "stat_min", stat: "WILL", value: 8, label: "WILL 8+" }],
  },
  {
    id: "flying_kick",
    name: "Flying Kick",
    form: "taekwondo",
    requirement: "MOVE 8+ e ter movido pelo menos 4m no Turno.",
    effect: "Usa Action + movimento restante. Ataque contra alvo até 4m. Causa dano normal de Martial Arts no corpo e deixa o alvo Prone.",
    kind: "attack",
    outcome: "Dano normal de Artes Marciais no corpo e alvo Prone.",
    requirements: [
      { type: "move_min", value: 8, label: "MOVE 8+" },
      { type: "turn_counter", flag: "movedMeters", value: 4, label: "movimentar pelo menos 4m neste turno" },
    ],
  },
];

export function getSpecialMoveById(id: string): SpecialMove | undefined {
  return SPECIAL_MOVES.find((move) => move.id === id);
}

export function getSpecialMovesForForm(form: MartialArtForm | "shared"): SpecialMove[] {
  return SPECIAL_MOVES.filter((move) => move.form === form);
}
