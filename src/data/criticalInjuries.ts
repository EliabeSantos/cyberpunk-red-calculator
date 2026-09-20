import type { HitLocation } from "@/types/combat";
import type { AttributeName } from "@/types/character";

/** Modificador mecânico aplicado por uma Critical Injury. */
export interface CriticalInjuryModifier {
  /** Tipo de modificador: "stat" para atributo, "skill" para perícia específica, "move" para movimento, "all_physical" para todas ações físicas, "all_mental" para todas mentais, "all_actions" para todas ações, "ranged" para ataques à distância, "melee" para corpo a corpo, "fine_manipulation" para manipulação fina, "two_handed" para armas duas mãos, "social" para sociais, "death_save" para death save. */
  type: "stat" | "skill" | "move" | "all_physical" | "all_mental" | "all_actions" | "ranged" | "melee" | "fine_manipulation" | "two_handed" | "social" | "death_save";
  /** Atributo afetado (quando type === "stat") */
  stat?: AttributeName;
  /** Perícia específica afetada (quando type === "skill") */
  skillId?: string;
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
}

/** Tabela oficial de Critical Injuries do Corpo (Body) — Cyberpunk RED Core Rulebook.
 * Usada para ataques no torso, braços e pernas (qualquer localização exceto cabeça).
 */
const bodyCriticalInjuries: CriticalInjury[] = [
  {
    roll: 2,
    name: "Dismembered Arm",
    effect: "Arm severed at shoulder. Cannot use two-handed weapons. −2 REF for two-handed tasks.",
    quickFix: "Tourniquet",
    treatment: "Surgery (DV 18)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "two_handed", value: -2, description: "Dismembered Arm: −2 REF for two-handed tasks" },
      { type: "stat", stat: "REF", value: -2, description: "Dismembered Arm: −2 REF for two-handed tasks" },
    ],
  },
  {
    roll: 3,
    name: "Dismembered Hand",
    effect: "Hand severed at wrist. Cannot use hand. −2 REF for fine manipulation.",
    quickFix: "Tourniquet",
    treatment: "Surgery (DV 16)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "fine_manipulation", value: -2, description: "Dismembered Hand: −2 REF for fine manipulation" },
      { type: "stat", stat: "REF", value: -2, description: "Dismembered Hand: −2 REF for fine manipulation" },
    ],
  },
  {
    roll: 4,
    name: "Collapsed Lung",
    effect: "Cannot speak above whisper. −2 on all physical actions. Suffocation in 1 minute per BOD.",
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
    effect: "Arm useless. Cannot use two-handed weapons. −2 REF for two-handed tasks.",
    quickFix: "Splint",
    treatment: "Surgery (DV 14) or Cast (4 weeks)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "two_handed", value: -2, description: "Broken Arm: −2 REF for two-handed tasks" },
      { type: "stat", stat: "REF", value: -2, description: "Broken Arm: −2 REF for two-handed tasks" },
    ],
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
    effect: "MOVE −4. Cannot run. −2 on physical actions using legs.",
    quickFix: "Splint",
    treatment: "Surgery (DV 14) or Cast (6 weeks)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "move", value: -4, description: "Broken Leg: MOVE −4" },
      { type: "melee", value: -2, description: "Broken Leg: −2 on physical actions using legs" },
      { type: "skill", skillId: "athletics", value: -2, description: "Broken Leg: −2 on physical actions using legs" },
      { type: "skill", skillId: "dance", value: -2, description: "Broken Leg: −2 on physical actions using legs" },
      { type: "skill", skillId: "contortionist", value: -2, description: "Broken Leg: −2 on physical actions using legs" },
      { type: "skill", skillId: "stealth", value: -2, description: "Broken Leg: −2 on physical actions using legs" },
    ],
  },
  {
    roll: 9,
    name: "Torn Muscle",
    effect: "−2 on physical actions using affected area.",
    quickFix: "Painkillers",
    treatment: "Rest (2 weeks)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "all_physical", value: -2, description: "Torn Muscle: −2 on physical actions using affected area" },
    ],
  },
  {
    roll: 10,
    name: "Spinal Injury",
    effect: "Paralyzed from injury down. MOVE 0. Cannot take physical actions.",
    quickFix: "None",
    treatment: "Surgery (DV 20)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "move", value: -99, description: "Spinal Injury: MOVE 0 (paralyzed)" },
      { type: "all_physical", value: -99, description: "Spinal Injury: Cannot take physical actions" },
    ],
  },
  {
    roll: 11,
    name: "Crushed Fingers",
    effect: "−2 REF for fine manipulation.",
    quickFix: "Splint",
    treatment: "Surgery (DV 12) or Cast (3 weeks)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "fine_manipulation", value: -2, description: "Crushed Fingers: −2 REF for fine manipulation" },
      { type: "stat", stat: "REF", value: -2, description: "Crushed Fingers: −2 REF for fine manipulation" },
    ],
  },
  {
    roll: 12,
    name: "Dismembered Leg",
    effect: "Leg severed at hip. MOVE 0. Cannot use legs.",
    quickFix: "Tourniquet",
    treatment: "Surgery (DV 18)",
    bonusDamage: 5,
    location: "body",
    modifiers: [
      { type: "move", value: -99, description: "Dismembered Leg: MOVE 0" },
      { type: "melee", value: -99, description: "Dismembered Leg: Cannot use legs" },
      { type: "skill", skillId: "athletics", value: -99, description: "Dismembered Leg: Cannot use legs" },
      { type: "skill", skillId: "dance", value: -99, description: "Dismembered Leg: Cannot use legs" },
      { type: "skill", skillId: "contortionist", value: -99, description: "Dismembered Leg: Cannot use legs" },
      { type: "skill", skillId: "stealth", value: -99, description: "Dismembered Leg: Cannot use legs" },
    ],
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
    effect: "−2 INT, −2 REF, −2 COOL. −2 on all mental actions.",
    quickFix: "None",
    treatment: "Surgery (DV 20)",
    bonusDamage: 5,
    location: "head",
    modifiers: [
      { type: "stat", stat: "INT", value: -2, description: "Brain Injury: −2 INT" },
      { type: "stat", stat: "REF", value: -2, description: "Brain Injury: −2 REF" },
      { type: "stat", stat: "COOL", value: -2, description: "Brain Injury: −2 COOL" },
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
    effect: "−2 INT, −2 REF, −2 COOL. Unconscious for 1d6 rounds.",
    quickFix: "None",
    treatment: "Rest (1 week)",
    bonusDamage: 5,
    location: "head",
    modifiers: [
      { type: "stat", stat: "INT", value: -2, description: "Concussion: −2 INT" },
      { type: "stat", stat: "REF", value: -2, description: "Concussion: −2 REF" },
      { type: "stat", stat: "COOL", value: -2, description: "Concussion: −2 COOL" },
    ],
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
    effect: "−2 REF, −2 MOVE. −2 on physical actions.",
    quickFix: "Painkillers",
    treatment: "Rest (2 weeks)",
    bonusDamage: 5,
    location: "head",
    modifiers: [
      { type: "stat", stat: "REF", value: -2, description: "Whiplash: −2 REF" },
      { type: "move", value: -2, description: "Whiplash: −2 MOVE" },
      { type: "all_physical", value: -2, description: "Whiplash: −2 on physical actions" },
    ],
  },
  {
    roll: 9,
    name: "Cracked Skull",
    effect: "−2 INT, −2 REF. Unconscious for 1d6 minutes.",
    quickFix: "None",
    treatment: "Surgery (DV 18)",
    bonusDamage: 5,
    location: "head",
    modifiers: [
      { type: "stat", stat: "INT", value: -2, description: "Cracked Skull: −2 INT" },
      { type: "stat", stat: "REF", value: -2, description: "Cracked Skull: −2 REF" },
    ],
  },
  {
    roll: 10,
    name: "Brain Damage",
    effect: "−2 INT, −2 REF, −2 COOL. Permanent −2 INT.",
    quickFix: "None",
    treatment: "Surgery (DV 20)",
    bonusDamage: 5,
    deathSavePenalty: -2,
    location: "head",
    modifiers: [
      { type: "stat", stat: "INT", value: -2, description: "Brain Damage: −2 INT" },
      { type: "stat", stat: "REF", value: -2, description: "Brain Damage: −2 REF" },
      { type: "stat", stat: "COOL", value: -2, description: "Brain Damage: −2 COOL" },
    ],
  },
  {
    roll: 11,
    name: "Crushed Windpipe",
    effect: "Cannot speak. Suffocation in 1 minute per BOD.",
    quickFix: "Tracheotomy",
    treatment: "Surgery (DV 18)",
    bonusDamage: 5,
    deathSavePenalty: -2,
    location: "head",
    modifiers: [
      { type: "social", value: -99, description: "Crushed Windpipe: Cannot speak" },
      { type: "death_save", value: -2, description: "Crushed Windpipe: Death Save −2" },
    ],
  },
  {
    roll: 12,
    name: "Severed Spinal Cord",
    effect: "Paralyzed from neck down. MOVE 0. Cannot take physical actions.",
    quickFix: "None",
    treatment: "Surgery (DV 20)",
    bonusDamage: 5,
    deathSavePenalty: -4,
    location: "head",
    modifiers: [
      { type: "move", value: -99, description: "Severed Spinal Cord: MOVE 0 (paralyzed)" },
      { type: "all_physical", value: -99, description: "Severed Spinal Cord: Cannot take physical actions" },
      { type: "death_save", value: -4, description: "Severed Spinal Cord: Death Save −4" },
    ],
  },
];

/** Mapeia cada HitLocation para a tabela oficial correspondente.
 * Conforme Cyberpunk RED: apenas Head usa tabela própria; todas as demais localizações usam a tabela Body.
 */
export const criticalInjuryTables: Record<HitLocation, CriticalInjury[]> = {
  head: headCriticalInjuries,
  body: bodyCriticalInjuries,
  right_arm: bodyCriticalInjuries,
  left_arm: bodyCriticalInjuries,
  right_leg: bodyCriticalInjuries,
  left_leg: bodyCriticalInjuries,
};

export { bodyCriticalInjuries, headCriticalInjuries };

/** Obtém uma Critical Injury aleatória (2d6) para a localização especificada.
 * Se a lesão já estiver sofrida pelo personagem, rola novamente até obter uma nova (regra oficial).
 */
export function rollCriticalInjury(
  location: HitLocation,
  existingInjuries: Set<string> = new Set()
): CriticalInjury {
  const table = criticalInjuryTables[location];
  let attempts = 0;
  const maxAttempts = table.length;

  while (attempts < maxAttempts) {
    // 2d6 roll
    const roll = Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1;
    const injury = table.find((inj) => inj.roll === roll);

    if (injury && !existingInjuries.has(injury.name)) {
      return injury;
    }
    attempts++;
  }

  // Fallback: retorna a primeira lesão não sofrida (ou a primeira se todas já sofridas)
  const available = table.find((inj) => !existingInjuries.has(inj.name)) ?? table[0];
  return available;
}

/** Verifica se os dados de dano contêm dois ou mais resultados 6 (Critical Injury por dados). */
export function checkCriticalInjuryFromDamage(rolls: number[]): boolean {
  const sixes = rolls.filter((r) => r === 6).length;
  return sixes >= 2;
}