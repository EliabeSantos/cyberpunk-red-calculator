/**
 * F1.12.3 — contratos compartilhados entre os blocos da tela do Player.
 *
 * Todos os painéis recebem o MESMO estado autoritativo (`MesaState`) e o
 * MESMO `run` do container `PlayerMesaScreen`. Nenhum painel guarda espelho de
 * HP/turno/ações: eles só desenham o que o servidor entregou.
 */

import type { MesaCombatant, MesaState } from "@/lib/mesa/types";

export type NoticeKind = "error" | "ok";
export type Notice = { message: string; kind: NoticeKind } | null;
export type NoticeFn = (message: string, kind: NoticeKind) => void;

export interface RunOptions {
  /** Mensagem exibida só quando a ação completa com sucesso. */
  success?: string;
  /**
   * Captura a falha INLINE (ex.: erro do ataque no próprio painel). Sem
   * `onError`, o aviso geral da tela é usado — nunca os dois.
   */
  onError?: (message: string) => void;
}

/** Executa uma mutação com busy global + refresh obrigatório no fim. */
export type RunAction = (action: () => Promise<void>, options?: RunOptions) => Promise<void>;

/** Base que todo bloco da tela recebe. */
export interface PlayerPanelBase {
  state: MesaState;
  /** Combatente que este navegador comanda (`null` = sem ficha vinculada). */
  me: MesaCombatant | null;
  /** Busy GLOBAL: uma mutação por vez em toda a tela. */
  busy: boolean;
  run: RunAction;
  /** Reconsulta o servidor (usado quando a ação já cuidou do próprio feedback). */
  onChanged: () => Promise<void>;
}
