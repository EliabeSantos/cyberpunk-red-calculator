/**
 * Snapshot e merge do HISTÓRICO de partidas (módulo puro, sem banco).
 *
 * A partida (`mesa_battles`) nasce no início do combate com a vida de ENTRADA
 * de cada linha; quando o combate termina, o registro é fechado com a vida
 * FINAL. O merge mora aqui (e não dentro de `store.ts`) para os testes
 * provarem as três pontas sem tocar em Supabase:
 *
 *   • quem continua na luta ganha `hpEnd`/`isDead`/`initiative` do estado final;
 *   • quem foi removido pelo Mestre fica com `removed: true` e `hpEnd: null`;
 *   • quem entrou DEPOIS do início (inimigo adicionado no meio) entra com a
 *     vida do momento como `hpStart` — não há como saber com que vida entrou.
 */
import type { MesaBattleCombatant, MesaCombatant } from "@/lib/mesa/types";

/** Registra quem entrou em combate e com que vida. */
export function startBattleSnapshot(combatants: MesaCombatant[]): MesaBattleCombatant[] {
  return combatants.map((combatant) => ({
    id: combatant.id,
    kind: combatant.kind,
    name: combatant.name,
    hpStart: combatant.hpCurrent,
    hpMax: combatant.hpMax,
    hpEnd: null,
    isDead: combatant.isDead,
    removed: false,
    initiative: combatant.initiative,
    sourceKey: combatant.sourceKey,
    ...(combatant.position ? { position: combatant.position } : {}),
  }));
}

/**
 * Fecha o registro: sobrepõe o snapshot de entrada com o estado FINAL.
 *
 * `snapshot` pode vir vazio (a escrita do início falhou) — nesse caso todo
 * combatente entra como "chegou no meio" e `hpStart` vira o HP final, o que
 * mantém o histórico coerente em vez de zerar a vida de entrada.
 */
export function mergeBattleRoster(
  snapshot: MesaBattleCombatant[],
  combatants: MesaCombatant[],
): MesaBattleCombatant[] {
  const current = new Map(combatants.map((combatant) => [combatant.id, combatant]));

  const merged = snapshot.map((entry) => {
    const row = current.get(entry.id);
    if (!row) {
      // Somiu da mesa antes do fim: preserva a última vida conhecida como
      // `hpStart` e marca a saída, sem inventar vida final.
      return { ...entry, hpEnd: null, removed: true };
    }
    return {
      ...entry,
      hpEnd: row.hpCurrent,
      isDead: row.isDead,
      initiative: row.initiative ?? entry.initiative,
      removed: false,
      ...(row.position || entry.position ? { positionEnd: row.position ?? entry.position } : {}),
    };
  });

  const known = new Set(snapshot.map((entry) => entry.id));
  for (const row of combatants) {
    if (known.has(row.id)) continue;
    merged.push({
      id: row.id,
      kind: row.kind,
      name: row.name,
      hpStart: row.hpCurrent,
      hpMax: row.hpMax,
      hpEnd: row.hpCurrent,
      isDead: row.isDead,
      removed: false,
      initiative: row.initiative,
      sourceKey: row.sourceKey,
      ...(row.position ? { position: row.position, positionEnd: row.position } : {}),
    });
  }

  return merged;
}
