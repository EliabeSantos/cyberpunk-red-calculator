/**
 * F1.12.6 — endereço da Mesa (`/mesa/[id]`) — módulo PURO, sem cliente/servidor.
 *
 * A rota `/mesa/[id]` atende DOIS endereços diferentes e o Next não permite
 * duas rotas dinâmicas irmãs (`[id]` e `[joinCode]` colidiria), então o
 * desempate acontece aqui, num único lugar:
 *
 *   /mesa/<uuid>  → sessão   → tela dedicada do Player (`PlayerMesaView`)
 *   /mesa/<CODE>  → convite  → entrada direta (`joinMesa` → mesmo uuid acima)
 *   qualquer outra coisa     → convite inválido (erro explícito, nunca silêncio)
 *
 * Um código de entrada tem 5 caracteres (`joinCode.ts`) e um `sessionId` é um
 * UUID — as duas formas nunca se confundem, então a ordem das regras é livre.
 *
 * Puro de propósito: o servidor decide o que renderizar, o navegador decide o
 * `replace` e os testes cobrem as regras sem DOM, sem rede e sem banco.
 */

import { normalizeJoinCode } from "@/lib/mesa/joinCode";

/** `uuid` do Postgres (versões 1–5, variante RFC 4122). */
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `true` só para o UUID de sessão — a mesma checagem que a rota usava inline. */
export function isMesaSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

export type MesaRouteTarget =
  /** `/mesa/<uuid>` — a tela do Player, que também é o destino do redirect. */
  | { kind: "session"; sessionId: string }
  /** `/mesa/<CODE>` — convite: o navegador entra pelo código e vira o caso acima. */
  | { kind: "invite"; joinCode: string }
  /** Nem uuid nem código de entrada: erro explícito. */
  | { kind: "invalid"; segment: string };

/** Decide o destino de `/mesa/[id]` a partir do segmento cru da URL. */
export function resolveMesaRoute(segment: unknown): MesaRouteTarget {
  const raw = typeof segment === "string" ? segment.trim() : "";
  if (isMesaSessionId(raw)) return { kind: "session", sessionId: raw };
  const joinCode = normalizeJoinCode(raw);
  if (joinCode) return { kind: "invite", joinCode };
  return { kind: "invalid", segment: raw };
}

/** Endereço canônico da tela do Player. Só use com uuid já validado. */
export function playerMesaHref(sessionId: string): string {
  return `/mesa/${sessionId}`;
}

/**
 * `true` quando este navegador JÁ entrou nesta mesa (assinatura no
 * `membershipStore`). Nesse caso o join é desnecessário: o `sessionId` da
 * assinatura é o mesmo destino do redirect, e a membership é o que faz a tela
 * `/mesa/<uuid>` autorizar a leitura do estado.
 */
export function hasMesaMembership(memberships: { entries: Record<string, { sessionId: string }> }, joinCode: string): boolean {
  return Boolean(memberships.entries[joinCode.toUpperCase()]);
}

export interface JoinFailure {
  title: string;
  hint: string;
}

/**
 * Falhas do `joinMesa` (`MesaError.code` do servidor) traduzidas para a tela.
 *
 * Nenhum erro redireciona: código inexistente, sessão encerrada, nome inválido
 * ou identidade indisponível param o jogador NA invitation, com o caminho de
 * volta explícito. `code` desconhecido cai no genérico e a mensagem do servidor
 * continua valendo (é mostrada como detalhe).
 */
export function describeJoinFailure(code: string | null | undefined): JoinFailure {
  switch (code) {
    case "invalid_join_code":
      return { title: "Código de mesa inválido", hint: "São 5 caracteres, como no convite do Mestre (ex.: 8F4K2)." };
    case "session_not_found":
      return { title: "Mesa não encontrada", hint: "Confira o código com o Mestre — esta mesa não existe mais." };
    case "session_finished":
      return { title: "Esta Mesa foi encerrada", hint: "A sessão terminou. Peça um novo convite para continuar." };
    case "invalid_display_name":
      return { title: "Nome inválido", hint: "Informe um nome de exibição com 1 a 40 caracteres." };
    case "missing_token":
      return { title: "Identidade do navegador indisponível", hint: "Seu navegador bloqueou o armazenamento local." };
    case "storage_unavailable":
      return {
        title: "Assinatura da Mesa não guardada",
        hint: "Este navegador não conseguiu salvar a entrada — habilite o armazenamento local para continuar.",
      };
    default:
      return { title: "Não foi possível entrar na Mesa", hint: "Tente de novo ou volte para a ficha." };
  }
}
