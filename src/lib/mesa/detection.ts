import type { RandomSource } from "@/lib/combat/contract";

/** Resultado da oposição oficial Stealth contra Perception. */
export interface DetectionCheckInput {
  observerPerception: number;
  targetStealth: number;
  rng: RandomSource;
}

export interface DetectionCheckResult {
  detected: boolean;
  observerTotal: number;
  targetTotal: number;
  observerRoll: number;
  targetRoll: number;
}

export interface RawSkillCheckInput {
  stat: number;
  skill: number;
  rng: RandomSource;
}

/** RAW Stealth: COOL + Stealth + 1d10. */
export function rollStealthCheck(input: RawSkillCheckInput): { total: number; roll: number } {
  const roll = input.rng.d10();
  return { roll, total: input.stat + input.skill + roll };
}

/** RAW Perception: INT + Perception + 1d10. */
export function rollPerceptionCheck(input: RawSkillCheckInput): { total: number; roll: number } {
  const roll = input.rng.d10();
  return { roll, total: input.stat + input.skill + roll };
}

/**
 * Cyberpunk RED usa uma oposição de Stealth contra Perception quando alguém
 * tenta passar despercebido. Os valores recebidos já devem ser STAT + skill;
 * a composição desses valores permanece no sistema de Skill Check existente.
 */
export function resolveDetectionCheck(input: DetectionCheckInput): DetectionCheckResult {
  const observerRoll = input.rng.d10();
  const targetRoll = input.rng.d10();
  const observerTotal = input.observerPerception + observerRoll;
  const targetTotal = input.targetStealth + targetRoll;
  return {
    // Em empate não há superioridade do observer; não revelar informação.
    detected: observerTotal > targetTotal,
    observerTotal,
    targetTotal,
    observerRoll,
    targetRoll,
  };
}
