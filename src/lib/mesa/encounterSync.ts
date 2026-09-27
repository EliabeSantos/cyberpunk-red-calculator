/**
 * Espelho da MESA no ENCONTRO do Mestre (módulo puro, navegador).
 *
 * Complementa o espelho ida (`encontro → mesa`, `publishMesaEnemyHp`) com a
 * volta que só existe DURANTE um combate vinculado (decisão de 27/09/2026):
 * enquanto a luta roda, **manda a mesa** — o dano aplicado pelo Mestre no
 * painel da mesa (−/+) e a morte de um inimigo "matado" por um player voltam
 * para o encontro, que é o registro permanente do Mestre.
 *
 * Duas funções, dois momentos:
 *
 *   • `applyMesaStateToEncounter` → ao vivo (Realtime/polling da mesa aberta);
 *   • `reconcileEncountersWithBattles` → ao abrir a tela, com o histórico que
 *     o servidor registrou (serve também quando a luta acabou com a tela fechada,
 *     ou quando outro separador lançou o mesmo encontro).
 *
 * Nada aqui escreve no servidor e nada aqui dispara espelho de volta para a
 * mesa: o empurrão (`publishMesaEnemyHp`) só nasce de clique do Mestre, então
 * não há loop.
 */
import type { EncounterData } from "@/lib/gmStorage";
import type { MesaBattle, MesaState } from "@/lib/mesa/types";

/**
 * Puxa o estado da mesa para dentro do encontro vinculado.
 *
 * Devolve `null` quando nada muda (HP igual, combate ainda na mesma, encontro
 * sem vínculo ou mesa de outra sessão) — quem chama compara com `null` para
 * não re-renderizar nem salvar à toa.
 */
export function applyMesaStateToEncounter(encounter: EncounterData, state: MesaState): EncounterData | null {
  const link = encounter.battle;
  if (!link || link.status !== "active") return null; // sem combate vinculado não há volta
  if (state.session.id !== link.sessionId) return null;

  let hpChanged = false;
  const participants = encounter.participants.map((participant) => {
    if (participant.isPlayer || !participant.id) return participant;
    const combatant = state.combatants.find((row) => row.kind === "enemy" && row.sourceKey === participant.id);
    if (!combatant) return participant;
    // Mantém o invariante local: 0 <= HP <= máximo (a mesa aceita negativo).
    const hp = Math.max(0, Math.min(participant.hp.max, Math.floor(combatant.hpCurrent)));
    if (hp === participant.hp.current) return participant;
    hpChanged = true;
    return { ...participant, hp: { ...participant.hp, current: hp } };
  });

  // Partida encerrada (por turno final ou por GM) → encontro deixa de ser
  // elegível para iniciar combate de novo.
  const finished = state.session.status === "finished" || state.combat?.status === "finished";
  if (!hpChanged && !finished) return null;

  const battle = finished
    ? {
        ...link,
        status: "completed" as const,
        completedAt: link.completedAt ?? new Date().toISOString(),
      }
    : link;

  return { ...encounter, battle, participants };
}

/**
 * Confere o vínculo local de cada encontro com o que o SERVIDOR registrou.
 *
 * Faz as três coisas que o histórico precisa:
 *   • marca como concluído o encontro cuja partida já foi fechada;
 *   • carrega o vínculo de encontro lançado noutro separador/navegador;
 *   • deixa o estado local intacto quando o servidor não tem registro (o
 *     histórico pode ter sido perdido — não se apaga dado local por isso).
 */
export function reconcileEncountersWithBattles(
  encounters: EncounterData[],
  battles: MesaBattle[],
): { encounters: EncounterData[]; changed: boolean } {
  const byEncounter = new Map<string, MesaBattle>();
  for (const battle of battles) {
    if (battle.encounterId) byEncounter.set(battle.encounterId, battle);
  }

  let changed = false;
  const reconciled = encounters.map((encounter) => {
    const battle = byEncounter.get(encounter.id);
    if (!battle) return encounter;

    const link = encounter.battle;
    if (link && link.status === battle.status && link.sessionId === battle.sessionId) return encounter;

    changed = true;
    const next: NonNullable<EncounterData["battle"]> = {
      sessionId: battle.sessionId,
      joinCode: battle.joinCode,
      status: battle.status,
      startedAt: battle.startedAt,
    };
    const completedAt = link?.completedAt ?? battle.endedAt ?? new Date().toISOString();
    if (battle.status === "completed") next.completedAt = completedAt;
    else if (link?.completedAt) next.completedAt = link.completedAt;

    return { ...encounter, battle: next };
  });

  return { encounters: reconciled, changed };
}
