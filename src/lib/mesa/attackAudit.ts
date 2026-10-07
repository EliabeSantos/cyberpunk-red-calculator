import type { AttackResult, DamageResult } from "@/lib/combat/contract";
import type { DiceResult } from "@/lib/dice";
import type { TacticalCoverResult } from "@/lib/mesa/tacticalGeometry";

/**
 * Texto persistido no evento de ataque.
 *
 * Importante: `defenseValue` é a defesa usada pelo Engine. `defenseRoll` é
 * somente o dado de Evasion e nunca pode ocupar o lugar daquele valor.
 */
export function formatMesaAttackEvent(input: {
  actorName: string;
  targetName: string;
  attackResult: AttackResult;
  weaponDamage?: DiceResult;
  damageResult?: DamageResult;
  tacticalCover?: TacticalCoverResult;
}): string {
  const { actorName, targetName, attackResult, weaponDamage, damageResult, tacticalCover } = input;
  const attackBase = attackResult.attackBase ?? attackResult.baseStat.value + attackResult.skill.value;
  return [
    `${actorName} → ${targetName}: ${attackResult.label}`,
    `ataque ${attackResult.total} (base ${attackBase} + d10 ${attackResult.roll.total}${attackResult.modifiers?.length ? ` + mods ${attackResult.modifiers.map((modifier) => `${modifier.source}:${modifier.value}`).join(", ")}` : ""})`,
    attackResult.hit ? "ACERTO" : "ERROU",
    `defesa ${attackResult.defenseType} ${attackResult.defenseValue}${attackResult.defenseRoll ? ` [${attackResult.defenseRoll.rolls.join(", ")}]` : ""}`,
    tacticalCover ? `cover ${tacticalCover.status} (${tacticalCover.blockedSamples}/${tacticalCover.totalSamples})` : "",
    weaponDamage ? `dano ${weaponDamage.total} [${weaponDamage.rolls.join(", ")}]` : "",
    damageResult
      ? `→ ${damageResult.damageAfterArmor} HP (${damageResult.hpBefore}→${damageResult.hpAfter}), SP ${damageResult.armorValue}, local ${damageResult.hitLocation}`
      : "",
  ].filter(Boolean).join(" · ");
}
