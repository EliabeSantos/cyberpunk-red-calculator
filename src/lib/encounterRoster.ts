/**
 * ROSTER DO ENCONTRO — a ÚNICA fonte de verdade entre o preview e a criação.
 *
 * Antes desta separação existiam **duas lógicas independentes**:
 *
 *   • o PREVIEW (`getPreviewEnemies`, dentro de `EncountersPageClient`) filtrava
 *     por facção + intervalo de nível e embaralhava com a semente do ↻;
 *   • o CREATE (`handleStartEncounter`) montava OUTRO pool pelo nível e chamava
 *     `createEncounterFromFaction`, que varria o catálogo **na ordem**, sem
 *     semente nenhuma.
 *
 * Resultado (reproduzido antes da correção, facção Maelstrom, count 4, seed 0):
 *
 *   PREVIEW: Gunner | Techie | Cyborg | Berserker
 *   CRIADO : Scrapper | Gunner | Berserker | Techie
 *
 * 3 das 4 instâncias diferentes e ordem diferente — o Mestre via um roster e
 * jogava outro. Agora os dois lados derivam do MESMO `EncounterRosterRequest`:
 *
 *     request ──► buildEncounterRoster ──► PREVIEW
 *              └─► createEncounterFromRoster ──► buildEncounterRoster ──► CREATE
 *
 * A criação não escolhe mais ninguém: ela materializa em participantes exatamente
 * a lista que o preview mostrou (mesma identidade, mesma ordem, mesma quantidade).
 * Instâncias continuam instâncias: cada participante ganha o seu `id` próprio.
 */
import { threatLevels } from "@/data/enemies";
import { gmEnemyCatalog } from "@/data/gm-enemies";
import { createEncounterFromFaction, type EncounterData } from "@/lib/gmStorage";
import type { Enemy } from "@/types/enemy";

/** Tudo que a tela sabe antes de criar: é deste objeto que os dois lados derivam. */
export interface EncounterRosterRequest {
  /** Facção escolhida ("" = nada selecionado). */
  faction: string;
  /** Intervalo de nível da UI, 1–4 (low → extreme). */
  minLevel: number;
  maxLevel: number;
  /** Quantos inimigos o GM pediu. */
  count: number;
  /** Semente do ↻ "Gerar outro roster". */
  seed: number;
}

/** Mesmo PRNG do preview original: determinístico para uma mesma semente. */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * O roster: facção + intervalo de nível + contagem + semente.
 *
 * Devolve `count` TEMPLATES (com repetição quando há menos elegíveis que o
 * pedido, sempre na mesma ordem para a mesma semente). É literalmente a lista
 * que a tela mostra — `createEncounterFromRoster` não refaz a escolha.
 */
export function buildEncounterRoster(
  request: EncounterRosterRequest,
  catalog: Enemy[] = gmEnemyCatalog,
): Enemy[] {
  const { faction, minLevel, maxLevel, count, seed } = request;
  if (!faction) return [];

  const minThreat = threatLevels[minLevel - 1] || "low";
  const maxThreat = threatLevels[maxLevel - 1] || "extreme";
  const minIndex = threatLevels.indexOf(minThreat);
  const maxIndex = threatLevels.indexOf(maxThreat);
  const eligible = catalog.filter(
    (enemy) =>
      enemy.identity.faction === faction &&
      enemy.identity.archetype &&
      threatLevels.indexOf(enemy.identity.threatLevel) >= minIndex &&
      threatLevels.indexOf(enemy.identity.threatLevel) <= maxIndex,
  );
  if (eligible.length === 0) return [];

  const rng = seededRandom(seed + count);
  const shuffled = [...eligible].sort(() => rng() - 0.5);
  // Wrap around quando há menos elegíveis do que o pedido.
  const roster: Enemy[] = [];
  for (let i = 0; i < count; i++) {
    roster.push(shuffled[i % shuffled.length]);
  }
  return roster;
}

/**
 * Cria o encontro a partir do MESMO request do preview — nunca de um pool
 * reconstruído. Um roster vazio (sem inimigos no intervalo) vira um encontro
 * sem participantes, exatamente o que a tela mostrou.
 */
export function createEncounterFromRoster(
  name: string,
  request: EncounterRosterRequest,
  catalog: Enemy[] = gmEnemyCatalog,
): EncounterData {
  return createEncounterFromFaction(
    name,
    request.faction,
    request.count,
    buildEncounterRoster(request, catalog),
  );
}
