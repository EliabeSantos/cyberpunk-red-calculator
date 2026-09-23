/**
 * Cálculo de permissões de canal do Discord (algoritmo oficial da API) —
 * módulo puro, sem rede, para permitir testes unitários. Usado pela versão
 * REST do bot para responder "o bot pode enviar neste canal?" sem gateway.
 *
 * Referência: https://discord.com/developers/docs/topics/permissions
 */

const ADMINISTRATOR = 1n << 3n;
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;

/**
 * Overwrite de permissão de canal.
 * API v10: `type` é número (0 = role, 1 = member); aceitamos também as
 * strings legadas ("role"/"member") por segurança.
 */
export interface ChannelOverwrite {
  id: string;
  type: number | string;
  allow: string;
  deny: string;
}

export interface GuildRole {
  id: string;
  /** permissões do papel em decimal (string), como devolvido pela API. */
  permissions: string;
}

export interface BotGuildMember {
  /** ids dos papéis do bot no servidor */
  roles: string[];
}

function bits(value: string | undefined | null): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function isRoleOverwrite(overwrite: ChannelOverwrite): boolean {
  return overwrite.type === 0 || overwrite.type === "role";
}

function isMemberOverwrite(overwrite: ChannelOverwrite): boolean {
  return overwrite.type === 1 || overwrite.type === "member";
}

/**
 * true quando o bot consegue VER e ENVIAR mensagens no canal.
 *
 * @param guildId guild atual — o papel @everyone tem o mesmo id do servidor
 * @param guildRoles papéis do servidor (deve incluir o @everyone)
 * @param member papéis do bot no servidor
 * @param botUserId id do usuário do bot (o overwrite de membro é aplicado por último)
 * @param overwrites overwrites do canal
 */
export function canBotSend(
  guildId: string,
  guildRoles: GuildRole[],
  member: BotGuildMember,
  botUserId: string,
  overwrites: ChannelOverwrite[],
): boolean {
  const everyone = guildRoles.find((role) => role.id === guildId);
  let permissions = bits(everyone?.permissions);

  //1) overwrite do @everyone
  const everyoneOverwrite = overwrites.find((overwrite) => overwrite.id === guildId);
  if (everyoneOverwrite) {
    permissions = (permissions & ~bits(everyoneOverwrite.deny)) | bits(everyoneOverwrite.allow);
  }

  //2) overwrite dos papéis que o bot possui: deny unificado, depois allow unificado
  let roleDeny = 0n;
  let roleAllow = 0n;
  for (const overwrite of overwrites) {
    if (!isRoleOverwrite(overwrite)) continue;
    if (!member.roles.includes(overwrite.id)) continue;
    roleDeny |= bits(overwrite.deny);
    roleAllow |= bits(overwrite.allow);
  }
  permissions = (permissions & ~roleDeny) | roleAllow;

  //3) overwrite do membro (o bot), sempre por último
  const memberOverwrite = overwrites.find(
    (overwrite) => isMemberOverwrite(overwrite) && overwrite.id === botUserId,
  );
  if (memberOverwrite) {
    permissions = (permissions & ~bits(memberOverwrite.deny)) | bits(memberOverwrite.allow);
  }

  if (permissions & ADMINISTRATOR) return true;
  return (permissions & VIEW_CHANNEL) !== 0n && (permissions & SEND_MESSAGES) !== 0n;
}
