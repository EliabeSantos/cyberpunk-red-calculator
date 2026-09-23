import type { DiscordRollKind, DiscordRollPayload } from "@/lib/discord/types";

/** Mesmos ícones usados no histórico de rolagens do site (DiceDrawer). */
const KIND_ICONS: Record<DiscordRollKind, string> = {
  skill_check: "🎯",
  attack: "⚔️",
  damage: "💥",
  evasion: "🛡️",
  free_roll: "🎲",
};

/** Monta a mensagem de rolagem a partir dos valores já calculados pelo site. */
export function formatRollMessage(payload: DiscordRollPayload): string {
  const icon = KIND_ICONS[payload.kind];
  const diceLine = `${payload.expression}: ${payload.rolls.join(" + ")}`;
  const modifierLine =
    payload.modifier !== 0
      ? `Modificador: ${payload.modifier > 0 ? "+" : ""}${payload.modifier}`
      : null;

  return [
    `🎲 **${payload.playerName.toUpperCase()}**`,
    "",
    `${icon} **${payload.rollType}**`,
    "",
    diceLine,
    ...(modifierLine ? [modifierLine] : []),
    "",
    `**Resultado: ${payload.total}**`,
  ].join("\n");
}
