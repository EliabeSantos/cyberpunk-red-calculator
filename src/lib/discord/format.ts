import type {
  DiscordInitiativePayload,
  DiscordMessagePayload,
  DiscordRollKind,
  DiscordRollPayload,
} from "@/lib/discord/types";

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

/**
 * Resumo de iniciativa do encontro: UMA única mensagem com a tabela completa,
 * na mesma ordem (decrescente) exibida na tela do GM. Cada linha reproduz
 * exatamente o que o site calculou: d10 + REF = total.
 */
export function formatInitiativeMessage(payload: DiscordInitiativePayload): string {
  const header = `🎲 **INICIATIVA — ${payload.encounterName.toUpperCase()}**`;
  const rows = payload.rows.map((row) => {
    const ref = row.ref !== 0 ? ` + ${row.ref} REF` : "";
    return `**${row.name}**: d10(${row.roll})${ref} = **${row.total}**`;
  });
  return [header, "", ...rows].join("\n");
}

/** Despacha pelo tipo de mensagem: rolagem única ou resumo de iniciativa. */
export function formatMessage(payload: DiscordMessagePayload): string {
  return payload.kind === "initiative" ? formatInitiativeMessage(payload) : formatRollMessage(payload);
}
