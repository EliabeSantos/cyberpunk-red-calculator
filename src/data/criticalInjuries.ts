import { rollDice } from "@/lib/dice";
import type { RandomSource } from "@/lib/combat/contract";
import type { DiceResult } from "@/lib/dice";
import type { HitLocation } from "@/types/combat";
import type { AttributeName } from "@/types/character";

/** Modificador mecânico aplicado por uma Critical Injury. */
export type CriticalInjuryArea = "arm" | "hand" | "leg" | "torso" | "head";

export type CriticalInjuryRestriction =
  | "cannot_run"
  | "cannot_speak"
  | "cannot_use_two_handed_weapons"
  | "cannot_use_affected_hand"
  | "cannot_use_affected_arm"
  | "cannot_use_legs"
  | "cannot_use_lower_body"
  | "unconscious";

export interface CriticalInjuryModifier {
  /** Tipo de modificador mecânico. `move_zero` é uma restrição semântica, não um número extremo. */
  type: "stat" | "skill" | "move" | "move_zero" | "area" | "all_physical" | "all_mental" | "all_actions" | "ranged" | "melee" | "fine_manipulation" | "two_handed" | "social" | "death_save";
  /** Atributo afetado (quando type === "stat") */
  stat?: AttributeName;
  /** Perícia específica afetada (quando type === "skill") */
  skillId?: string;
  /** Área afetada (quando type === "area") */
  area?: CriticalInjuryArea;
  /** Valor do modificador (negativo para penalidade, positivo para bônus) */
  value: number;
  /** Descrição legível do modificador para exibição na UI */
  description: string;
}

/** Estrutura completa de uma Critical Injury baseada no Cyberpunk RED Core Rulebook. */
export interface CriticalInjury {
  roll: number; // 2-12
  name: string;
  effect: string;
  quickFix: string;
  treatment: string;
  bonusDamage: number; // Sempre 5 conforme regra oficial
  deathSavePenalty?: number; // Penalidade no Death Save quando aplicável
  location: HitLocation;
  /** Modificadores mecânicos estruturados para aplicação automática em rolagens. */
  modifiers: CriticalInjuryModifier[];
  /** Área usada por efeitos específicos (por exemplo, Torn Muscle). */
  affectedArea?: CriticalInjuryArea;
  /** Restrições semânticas que não devem ser simuladas com números extremos. */
  restrictions?: CriticalInjuryRestriction[];
  /** Duração da inconsciência; o valor é materializado quando a lesão é rolada. */
  unconsciousRounds?: number;
  /** Rodada final da inconsciência quando a lesão foi gerada pelo Combat Engine. */
  unconsciousUntilRound?: number;
  /** Expressão da duração definida pelo catálogo, antes da materialização. */
  unconsciousRoundsDie?: "1d3";
  /** Penalidade permanente separada da penalidade temporária. */
  permanentModifiers?: CriticalInjuryModifier[];
}

/** Tabela oficial de Critical Injuries do Corpo (Body) — Cyberpunk RED Core Rulebook.
 * Usada para ataques no torso, braços e pernas (qualquer localização exceto cabeça).
 */
const bodyCriticalInjuries: CriticalInjury[] = [
  {
    roll: 2,
    name: "Dismembered Arm",
    effect: "Arm severed at shoulder. Cannot use two-handed weapons. −2 on actions depending on the affected arm.",
    quickFix: "Tourniquet",
    treatment: "Surgery (DV 18)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "two_handed", value: -2, description: "Dismembered Arm: −2 REF for two-handed tasks" },
    ],
    affectedArea: "arm",
    restrictions: ["cannot_use_two_handed_weapons", "cannot_use_affected_arm"],
  },
  {
    roll: 3,
    name: "Dismembered Hand",
    effect: "Hand severed at wrist. Cannot use hand. −2 on fine manipulation and actions depending on the affected hand.",
    quickFix: "Tourniquet",
    treatment: "Surgery (DV 16)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "fine_manipulation", value: -2, description: "Dismembered Hand: −2 REF for fine manipulation" },
    ],
    affectedArea: "hand",
    restrictions: ["cannot_use_two_handed_weapons", "cannot_use_affected_hand"],
  },
  {
    roll: 4,
    name: "Collapsed Lung",
    effect: "Cannot speak above whisper. −2 on all physical actions. Suffocation remains narrative for now.",
    quickFix: "Chest Seal",
    treatment: "Surgery (DV 18)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "all_physical", value: -2, description: "Collapsed Lung: −2 on all physical actions" },
    ],
  },
  {
    roll: 5,
    name: "Broken Ribs",
    effect: "−2 on all physical actions.",
    quickFix: "Painkillers",
    treatment: "Rest (1 week)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "all_physical", value: -2, description: "Broken Ribs: −2 on all physical actions" },
    ],
  },
  {
    roll: 6,
    name: "Broken Arm",
    effect: "Arm useless. Cannot use two-handed weapons. −2 on actions depending on the affected arm.",
    quickFix: "Splint",
    treatment: "Surgery (DV 14) or Cast (4 weeks)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "two_handed", value: -2, description: "Broken Arm: −2 REF for two-handed tasks" },
    ],
    affectedArea: "arm",
    restrictions: ["cannot_use_two_handed_weapons", "cannot_use_affected_arm"],
  },
  {
    roll: 7,
    name: "Foreign Object",
    effect: "−2 on all physical actions. Object still inside.",
    quickFix: "None",
    treatment: "Surgery (DV 16)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "all_physical", value: -2, description: "Foreign Object: −2 on all physical actions" },
    ],
  },
  {
    roll: 8,
    name: "Broken Leg",
    effect: "MOVE −2. Cannot run. −2 on actions depending on the affected leg.",
    quickFix: "Splint",
    treatment: "Surgery (DV 14) or Cast (6 weeks)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "move", value: -2, description: "Broken Leg: MOVE −2" },
      { type: "melee", value: -2, description: "Broken Leg: −2 on actions depending on the leg" },
      { type: "skill", skillId: "athletics", value: -2, description: "Broken Leg: −2 on physical actions using legs" },
      { type: "skill", skillId: "dance", value: -2, description: "Broken Leg: −2 on physical actions using legs" },
      { type: "skill", skillId: "contortionist", value: -2, description: "Broken Leg: −2 on physical actions using legs" },
      { type: "skill", skillId: "stealth", value: -2, description: "Broken Leg: −2 on physical actions using legs" },
    ],
    affectedArea: "leg",
    restrictions: ["cannot_run"],
  },
  {
    roll: 9,
    name: "Torn Muscle",
    effect: "−2 on actions related to the affected area.",
    quickFix: "Painkillers",
    treatment: "Rest (2 weeks)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "area", area: "torso", value: -2, description: "Torn Muscle: −2 on actions related to the affected area" },
    ],
    affectedArea: "torso",
  },
  {
    roll: 10,
    name: "Spinal Injury",
    effect: "Paralyzed from the injury down. MOVE 0. Cannot run or perform actions depending on the lower body.",
    quickFix: "None",
    treatment: "Surgery (DV 20)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "move_zero", value: 0, description: "Spinal Injury: MOVE 0 (paralyzed)" },
    ],
    restrictions: ["cannot_run", "cannot_use_lower_body"],
  },
  {
    roll: 11,
    name: "Crushed Fingers",
    effect: "−2 on fine manipulation and actions depending on the fingers.",
    quickFix: "Splint",
    treatment: "Surgery (DV 12) or Cast (3 weeks)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "fine_manipulation", value: -2, description: "Crushed Fingers: −2 on fine manipulation" },
    ],
    affectedArea: "hand",
  },
  {
    roll: 12,
    name: "Dismembered Leg",
    effect: "Leg severed at hip. MOVE 0. Cannot run or perform actions depending on the legs.",
    quickFix: "Tourniquet",
    treatment: "Surgery (DV 18)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "move_zero", value: 0, description: "Dismembered Leg: MOVE 0" },
      { type: "melee", value: -2, description: "Dismembered Leg: −2 on melee actions depending on the leg" },
      { type: "skill", skillId: "athletics", value: -2, description: "Dismembered Leg: −2 on actions depending on the legs" },
      { type: "skill", skillId: "dance", value: -2, description: "Dismembered Leg: −2 on actions depending on the legs" },
      { type: "skill", skillId: "contortionist", value: -2, description: "Dismembered Leg: −2 on actions depending on the legs" },
      { type: "skill", skillId: "stealth", value: -2, description: "Dismembered Leg: −2 on actions depending on the legs" },
    ],
    affectedArea: "leg",
    restrictions: ["cannot_run", "cannot_use_legs"],
  },
];

/** Tabela oficial de Critical Injuries da Cabeça (Head) — Cyberpunk RED Core Rulebook.
 * Usada apenas para ataques direcionados à cabeça (Aimed Shot: Head).
 */
const headCriticalInjuries: CriticalInjury[] = [
  {
    roll: 2,
    name: "Lost Eye",
    effect: "Lose vision in one eye. −2 PER for vision. −2 REF for ranged attacks.",
    quickFix: "None",
    treatment: "Cyberoptic (DV 14)",
    bonusDamage: 5,
    location: "head",
    modifiers: [
      { type: "skill", skillId: "perception", value: -2, description: "Lost Eye: −2 PER for vision" },
      { type: "ranged", value: -2, description: "Lost Eye: −2 REF for ranged attacks" },
    ],
  },
  {
    roll: 3,
    name: "Brain Injury",
    effect: "−2 INT, −1 REF, −1 COOL, and −2 on all mental actions.",
    quickFix: "None",
    treatment: "Surgery (DV 20)",
    bonusDamage: 5,
    location: "head",
    modifiers: [
      { type: "stat", stat: "INT", value: -2, description: "Brain Injury: −2 INT" },
      { type: "stat", stat: "REF", value: -1, description: "Brain Injury: −1 REF" },
      { type: "stat", stat: "COOL", value: -1, description: "Brain Injury: −1 COOL in directly affected actions" },
      { type: "all_mental", value: -2, description: "Brain Injury: −2 on all mental actions" },
    ],
  },
  {
    roll: 4,
    name: "Damaged Eye",
    effect: "−2 PER for vision. −2 REF for ranged attacks.",
    quickFix: "Eyepatch",
    treatment: "Surgery (DV 14)",
    bonusDamage: 5,
    location: "head",
    modifiers: [
      { type: "skill", skillId: "perception", value: -2, description: "Damaged Eye: −2 PER for vision" },
      { type: "ranged", value: -2, description: "Damaged Eye: −2 REF for ranged attacks" },
    ],
  },
  {
    roll: 5,
    name: "Concussion",
    effect: "−2 INT, −1 REF, −1 COOL. Unconscious for 1d3 rounds.",
    quickFix: "None",
    treatment: "Rest (1 week)",
    bonusDamage: 5,
    location: "head",
    modifiers: [
      { type: "stat", stat: "INT", value: -2, description: "Concussion: −2 INT" },
      { type: "stat", stat: "REF", value: -1, description: "Concussion: −1 REF" },
      { type: "stat", stat: "COOL", value: -1, description: "Concussion: −1 COOL" },
    ],
    restrictions: ["unconscious"],
    unconsciousRoundsDie: "1d3",
  },
  {
    roll: 6,
    name: "Broken Jaw",
    effect: "Cannot speak clearly. Cannot eat solid food. −2 Social.",
    quickFix: "Wiring shut",
    treatment: "Surgery (DV 12) or Wired (4 weeks)",
    bonusDamage: 5,
    location: "head",
    modifiers: [
      { type: "social", value: -2, description: "Broken Jaw: −2 Social" },
    ],
  },
  {
    roll: 7,
    name: "Foreign Object",
    effect: "−2 on all actions. Object still inside.",
    quickFix: "None",
    treatment: "Surgery (DV 16)",
    bonusDamage: 5,
    location: "head",
    modifiers: [
      { type: "all_actions", value: -2, description: "Foreign Object (Head): −2 on all actions" },
    ],
  },
  {
    roll: 8,
    name: "Whiplash",
    effect: "−1 REF, −1 MOVE. −2 on physical actions.",
    quickFix: "Painkillers",
    treatment: "Rest (2 weeks)",
    bonusDamage: 5,
    location: "head",
    modifiers: [
      { type: "stat", stat: "REF", value: -1, description: "Whiplash: −1 REF" },
      { type: "move", value: -1, description: "Whiplash: −1 MOVE" },
      { type: "all_physical", value: -2, description: "Whiplash: −2 on physical actions" },
    ],
  },
  {
    roll: 9,
    name: "Cracked Skull",
    effect: "−2 INT, −1 REF. Unconscious for 1d3 rounds.",
    quickFix: "None",
    treatment: "Surgery (DV 18)",
    bonusDamage: 5,
    location: "head",
    modifiers: [
      { type: "stat", stat: "INT", value: -2, description: "Cracked Skull: −2 INT" },
      { type: "stat", stat: "REF", value: -1, description: "Cracked Skull: −1 REF" },
    ],
    restrictions: ["unconscious"],
    unconsciousRoundsDie: "1d3",
  },
  {
    roll: 10,
    name: "Brain Damage",
    effect: "−2 INT, −1 REF, −1 COOL. Permanent −1 INT.",
    quickFix: "None",
    treatment: "Surgery (DV 20)",
    bonusDamage: 5,
    deathSavePenalty: -2,
    location: "head",
    modifiers: [
      { type: "stat", stat: "INT", value: -2, description: "Brain Damage: −2 INT" },
      { type: "stat", stat: "REF", value: -1, description: "Brain Damage: −1 REF" },
      { type: "stat", stat: "COOL", value: -1, description: "Brain Damage: −1 COOL" },
    ],
    permanentModifiers: [
      { type: "stat", stat: "INT", value: -1, description: "Brain Damage: permanent −1 INT" },
      { type: "death_save", value: -2, description: "Brain Damage: Death Save −2" },
    ],
  },
  {
    roll: 11,
    name: "Crushed Windpipe",
    effect: "Cannot speak. Verbal communication is unavailable. Suffocation remains narrative for now.",
    quickFix: "Tracheotomy",
    treatment: "Surgery (DV 18)",
    bonusDamage: 5,
    deathSavePenalty: -2,
    location: "head",
    modifiers: [
      { type: "death_save", value: -2, description: "Crushed Windpipe: Death Save −2" },
    ],
    restrictions: ["cannot_speak"],
  },
  {
    roll: 12,
    name: "Severed Spinal Cord",
    effect: "Paralyzed from neck down. MOVE 0. Cannot run or perform physical actions involving paralyzed regions.",
    quickFix: "None",
    treatment: "Surgery (DV 20)",
    bonusDamage: 5,
    deathSavePenalty: -2,
    location: "head",
    modifiers: [
      { type: "move_zero", value: 0, description: "Severed Spinal Cord: MOVE 0 (paralyzed)" },
      { type: "death_save", value: -2, description: "Severed Spinal Cord: Death Save −2" },
    ],
    restrictions: ["cannot_run", "cannot_use_lower_body"],
  },
];

/** Mapeia cada HitLocation para a tabela oficial correspondente.
 * Conforme Cyberpunk RED: apenas Head usa tabela própria; todas as demais localizações usam a tabela Body.
 */
export const criticalInjuryTables: Record<HitLocation, CriticalInjury[]> = {
  head: headCriticalInjuries,
  body: bodyCriticalInjuries,
  leg: bodyCriticalInjuries,
  held_item: bodyCriticalInjuries,
};

export { bodyCriticalInjuries, headCriticalInjuries };

/** Obtém uma Critical Injury aleatória (2d6) para a localização especificada.
 * Se a lesão já estiver sofrida pelo personagem, rola novamente até obter uma nova (regra oficial).
 *
 * F1.4: `rng` é opcional e vem DEPOIS de `existingInjuries` para não mexer nas
 * chamadas existentes — sem ele a rolagem é a de sempre (`browserRandom`). O
 * Os consumidores de dano passam a lista atual para que a mesma lesão não seja
 * adicionada duas vezes. */
export function rollCriticalInjury(
  location: HitLocation,
  existingInjuries: Set<string> = new Set(),
  rng?: RandomSource
): CriticalInjury {
  return rollCriticalInjuryDetail(location, existingInjuries, rng).injury;
}

/** A lesão E o 2d6 que a produziu — o que `CombatResult.rolls` publica (F1.5). */
export interface CriticalInjuryRoll {
  injury: CriticalInjury;
  roll: DiceResult;
}

/**
 * O mesmo laço de `rollCriticalInjury`, devolvendo também a rolagem.
 *
 * A primeira rolagem sai antes do laço para que o 2d6 conclusivo sempre exista
 * (as tabelas nunca são vazias), mantendo a contagem de sorteios de sempre:
 * 1 quando acerta na primeira, `table.length` quando tudo falha.
 */
export function rollCriticalInjuryDetail(
  location: HitLocation,
  existingInjuries: Set<string> = new Set(),
  rng?: RandomSource
): CriticalInjuryRoll {
  const table = criticalInjuryTables[location];
  const maxAttempts = table.length;
  let attempts = 0;
  let roll = rollDice("2d6", rng);
  let injury = table.find((entry) => entry.roll === roll.total);

  while (attempts < maxAttempts && (!injury || existingInjuries.has(injury.name))) {
    attempts++;
    roll = rollDice("2d6", rng);
    injury = table.find((entry) => entry.roll === roll.total);
  }

  if (injury && !existingInjuries.has(injury.name)) return { injury: materializeCriticalInjury(injury, rng), roll };

  // Fallback: retorna a primeira lesão não sofrida (ou a primeira se todas já sofridas)
  const available = table.find((inj) => !existingInjuries.has(inj.name)) ?? table[0];
  return { injury: materializeCriticalInjury(available, rng), roll };
}

/** Materializa apenas efeitos temporais definidos pelo catálogo. */
function materializeCriticalInjury(injury: CriticalInjury, rng?: RandomSource): CriticalInjury {
  if (injury.unconsciousRoundsDie !== "1d3") return injury;
  return { ...injury, unconsciousRounds: rollDice("1d3", rng).total };
}

export function isCriticalInjuryUnconsciousAtRound(injury: CriticalInjury, round: number): boolean {
  return injury.unconsciousUntilRound !== undefined && round <= injury.unconsciousUntilRound;
}

/** Verifica se os dados de dano contêm dois ou mais resultados 6 (Critical Injury por dados). */
export function checkCriticalInjuryFromDamage(rolls: number[]): boolean {
  const sixes = rolls.filter((r) => r === 6).length;
  return sixes >= 2;
}
