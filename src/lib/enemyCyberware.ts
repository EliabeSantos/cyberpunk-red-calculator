/**
 * Implantes (cyberware) do inimigo → **os mesmos** efeitos de rolagem da ficha.
 *
 * O inimigo não tem ficha, mas os implantes saem do **mesmo catálogo**
 * (`items.json`) que o jogador usa. Este módulo só monta uma "visão de ficha" a
 * partir da lista de nomes (`EncounterParticipant.implants` / `Enemy.cyberware`)
 * e delega tudo para `src/lib/cyberwareEffects.ts` — assim ataque, Evasão,
 * Iniciativa, dano desarmado e SP do corpo seguem exatamente a regra do
 * jogador, com uma única fonte de verdade. Mudou o catálogo, mudou os dois lados.
 *
 * Decisão do Mestre (30/09/2026): o inimigo **não tem botão de ativação**, então
 * o primeiro estágio de cada peça conta como ligado (`activeStage: 0`). É o que
 * faz Sandevistan/Kerenzikov somarem Iniciativa e Evasão para cá. O estágio 2+
 * continua sendo decisão do jogador — não há UI para ligar/desligar no inimigo.
 *
 * Fora do escopo por enquanto: bônus de MOVE (Adrenaline Booster) — mexe no
 * orçamento de movimento da mesa, não em rolagem.
 */
import { catalogItems } from "@/data/items";
import {
  getCyberwareAttackModifiers,
  getCyberwareBodySP,
  getCyberwareEvasionModifiers,
  getCyberwareInitiativeModifiers,
  getCyberwarePhysicalModifiers,
  getCyberwareSkillModifierFor,
  getCyberwareUnarmedDamageDice,
  isSmartWeapon,
} from "@/lib/cyberwareEffects";
import type { AttackModifier } from "@/types/attack";
import type { Character } from "@/types/character";

/** Mesma lista de perícia à distância de `src/lib/attacks.ts` (não é exportada de lá). */
const RANGED_SKILL_IDS = ["archery", "autofire", "handgun", "heavy_weapons", "shoulder_arms"];

/** Recorte da ficha que `cyberwareEffects` lê — nada além disso importa aqui. */
export type EnemyCyberwareView = Pick<Character, "cyberware">;

/**
 * Converte a lista de nomes de implantes no formato que o motor do jogador já
 * entende. `activeStage: 0` = **primeiro estágio sempre ligado** (ver cabeçalho);
 * peças sem `activation` ignoram o campo (`getActiveStage` cai em `undefined`).
 */
export function enemyCyberwareView(implants?: string[] | null): EnemyCyberwareView {
  const names = Array.isArray(implants) ? implants : [];
  return {
    cyberware: names
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      .map((name, index) => ({
        id: `enemy-implant-${index}`,
        name: name.trim(),
        installedAt: "",
        activeStage: 0,
      })),
  };
}

/** `true` quando a perícia é de ataque à distância (Targeting Scope vale aqui). */
export function isRangedSkillId(skillId?: string | null): boolean {
  return typeof skillId === "string" && RANGED_SKILL_IDS.includes(skillId);
}

/**
 * Arma smart **pelo nome**, mesmo predicado `isSmartWeapon` do jogador.
 * Participante de encontro só guarda o nome da arma, não o item do catálogo.
 */
export function isSmartWeaponByName(name?: string | null): boolean {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return false;
  const item = catalogItems.find((entry) => entry.category === "weapon" && entry.name === trimmed);
  return item ? isSmartWeapon(item) : false;
}

/** Soma de uma lista de modificadores (0 para lista vazia). */
export function sumModifiers(modifiers: readonly AttackModifier[]): number {
  return modifiers.reduce((total, modifier) => total + modifier.value, 0);
}

/** "todo teste físico" é `SourcedCyberwareModifier` — vira `AttackModifier` como no jogador. */
function physicalModifiers(view: EnemyCyberwareView): AttackModifier[] {
  return getCyberwarePhysicalModifiers(view).map((modifier) => ({
    source: `${modifier.source} (físico)`,
    value: modifier.value,
  }));
}

/**
 * Bônus de ATAQUE dos implantes: Targeting Scope (à distância), Smart Link
 * (arma smart), bônus de perícia (Gorilla Arms → +2 Briga) e "todo teste
 * físico" — mesma ordem e mesmos rótulos de `src/lib/attacks.ts`.
 */
export function getEnemyAttackModifiers(
  implants: string[] | null | undefined,
  options: { skillId?: string | null; ranged: boolean; smart?: boolean },
): AttackModifier[] {
  const view = enemyCyberwareView(implants);
  return [
    ...getCyberwareAttackModifiers(view, {
      ranged: options.ranged,
      smart: options.smart ?? false,
      skillId: options.skillId ?? undefined,
    }),
    ...physicalModifiers(view),
  ];
}

/** Bônus de EVASÃO dos implantes (Kerenzikov/Sandevistan no estágio ligado). */
export function getEnemyEvasionModifiers(implants: string[] | null | undefined): AttackModifier[] {
  const view = enemyCyberwareView(implants);
  return [...getCyberwareEvasionModifiers(view), ...physicalModifiers(view)];
}

/** Bônus de INICIATIVA dos implantes, item a item (para exibir a fonte). */
export function getEnemyInitiativeModifiers(implants: string[] | null | undefined): AttackModifier[] {
  return getCyberwareInitiativeModifiers(enemyCyberwareView(implants));
}

/** Bônus de INICIATIVA agregado — é o que entra na conta `1d10 + REF + bônus`. */
export function getEnemyInitiativeBonus(implants: string[] | null | undefined): number {
  return sumModifiers(getEnemyInitiativeModifiers(implants));
}

/** Bônus de PERÍCIA (ex.: Audio Filter → +2 Percepção), mesmo caminho da ficha. */
export function getEnemySkillModifiers(
  implants: string[] | null | undefined,
  skillId: string,
): AttackModifier[] {
  return getCyberwareSkillModifierFor(enemyCyberwareView(implants), skillId).map((modifier) => ({
    source: modifier.source,
    value: modifier.value,
  }));
}

/** Dados extras do ATAQUE DESARMADO (Gorilla Arms: 1 → +1d6). */
export function getEnemyUnarmedDamageDice(implants: string[] | null | undefined): number {
  return getCyberwareUnarmedDamageDice(enemyCyberwareView(implants));
}

/** SP extra do CORPO (Subdermal Armor 11 / Skin Weave 7) — não acumula com armadura. */
export function getEnemyBodySP(implants: string[] | null | undefined): number {
  return getCyberwareBodySP(enemyCyberwareView(implants));
}
