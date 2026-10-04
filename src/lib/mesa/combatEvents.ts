/**
 * F1.6 — ADAPTER de integração: `CombatResult.events` → `store.appendEvent`.
 *
 * O motor de combate continua PURO: ele produz `CombatResult` com `events` no
 * formato do contrato (`CombatEvent = Omit<MesaEvent, "at">`) e jamais importa
 * store, Supabase ou `gmStorage` (provado em `tests/combat-purity.test.ts`).
 * Este módulo — FORA do núcleo de combate — é a única ponte até o Event Log:
 *
 *     CombatState + CombatAction
 *               ↓
 *     engine.execute(state, action, rng)     src/lib/combat/engine.ts (puro)
 *               ↓
 *     persistCombatResult(combatId, result)  ← este adapter (servidor)
 *               ↓
 *     store.appendEvent(combatId, evento)    único escritor do log (F0.1)
 *               ↓
 *     mesa_combats.event_log
 *
 * ## Semântica (verificada nos consumidores existentes, sem inventar nada)
 *
 * `MesaEvent` tem 9 kinds (`src/lib/mesa/types.ts`). O que a Mesa grava hoje:
 * `combat_started`/`combat_finished` (`startCombat`/`endCombat`),
 * `initiative`/`turn`/`round` (iniciativa e turno), `enemy` (`addEnemies`),
 * `action` (`performAction`) e `roll` (`registerRoll`); o kind `join` existe
 * no tipo mas nenhum caminho grava. Dano, HP, degradação de armadura e
 * Critical Injury NÃO viram evento hoje: vivem em `changes`/estado (e no
 * histórico da ficha). Por isso este adapter NÃO deriva eventos de `changes` —
 * mudança de estado e evento são conceitos distintos (seção 9 do contrato) —
 * nem de `rolls`: rolagens seguem o caminho próprio (`registerRoll`).
 *
 * ## Responsabilidades
 *
 *  • `at`: exclusivo do store (`appendEvent` carimba) — a conversão projeta
 *    `{kind, text}` e descarta timestamp que venha de fora;
 *  • falha: o erro do store (`DatabaseQueryError`) é PROPAGADO, nunca
 *    engolido nem convertido em sucesso silencioso;
 *  • `events: []` → nenhuma chamada ao banco (nenhum evento inventado).
 *
 * ## Limitações (documentadas, não resolvidas aqui)
 *
 *  • sem transação: N eventos = N leituras+escritas; uma falha no meio deixa
 *    os anteriores gravados (mesma janela de corrida do F0.1);
 *  • sem idempotência: repetir a chamada repete os eventos — o formato não
 *    tem token de deduplicação (coberto como limitação no teste);
 *  • sem consumidor de produção HOJE: `engine.execute` ainda não é chamado
 *    por nenhuma rota. Quem o adotar (F1.7/F2 — o ponto natural é junto do
 *    espelho de HP em `/api/mesa/[id]/combat/hp`) passa o `CombatResult` por
 *    aqui. Enquanto isso `damage` devolve `events: []`: registrar dano/HP no
 *    log seria comportamento NOVO, não uma migração do que existe.
 */
import { appendEvent } from "@/lib/mesa/store";
import type { CombatEvent, CombatResult } from "@/lib/combat/contract";
import type { MesaEvent } from "@/lib/mesa/types";

/** Evento no formato persistido: `MesaEvent` SEM `at` (o store carimba). */
type PersistedCombatEvent = Omit<MesaEvent, "at">;

/**
 * Converte eventos do contrato no formato que `appendEvent` persiste.
 *
 * Projeção de `{kind, text}`: é o mesmo evento sem carimbo de tempo — e com a
 * garantia de que nenhum `at` vindo de um resultado montado à mão entra na
 * conta. Não muta a entrada; devolve objetos novos.
 */
export function toPersistedEvents(events: readonly CombatEvent[]): PersistedCombatEvent[] {
  return events.map((event) => ({ kind: event.kind, text: event.text }));
}

/**
 * Persiste os eventos de UM `CombatResult` no Event Log da Mesa, em ordem.
 *
 * • Um `appendEvent` por evento, sequencial (a ordem do `CombatResult` vira a
 *   ordem do log);
 * • `events: []` não toca o banco — nada é inventado a partir de `changes`,
 *   `rolls` ou do próprio resultado;
 * • o `result` NÃO é modificado: os eventos persistidos são projeções novas;
 * • erro do store propaga (sem transação: ver limitações no cabeçalho).
 *
 * Não interpreta `result.ok`: o motor garante `events: []` em falha, e o
 * adapter persiste exatamente o que existe.
 */
export async function persistCombatResult(combatId: string, result: CombatResult): Promise<void> {
  for (const event of toPersistedEvents(result.events)) {
    await appendEvent(combatId, event);
  }
}
