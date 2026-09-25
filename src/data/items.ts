import rawCatalog from "@/data/items.json" with { type: "json" };

export type ItemCategory = "cyberware" | "weapon" | "armor" | "healing" | "grenade" | "ammunition" | "electronics" | "netrunner" | "tool" | "drone" | "survival" | "clothing" | "consumable" | "drug" | "gear" | "mission_item";

/** Efeito numérico estruturado de um cyberware.
 * `effects` continua sendo o texto exibido ao jogador; `modifiers` é o que o motor realmente aplica.
 * Só devem entrar aqui efeitos PASSIVOS (sempre ativos enquanto instalados) — efeitos ativáveis,
 * por rodada ou condicionais ficam para o sistema de ativação.
 */
export type CyberwareModifier =
  /** Bônus/penalidade numa perícia específica (ex.: Gorilla Arms → brawling +2). */
  | { type: "skill"; skill: string; value: number }
  /** Bônus em rolagens de ataque à distância (ex.: Targeting Scope → +1). */
  | { type: "attack_ranged"; value: number }
  /** Bônus em ataques com armas compatíveis com Smart Link. */
  | { type: "attack_smart"; value: number }
  /** Bônus em testes de Evasão. */
  | { type: "evasion"; value: number }
  /** Bônus em Iniciativa. */
  | { type: "initiative"; value: number }
  /** SP extra do corpo (Subdermal Armor, Skin Weave). Não acumula com armadura: vale o maior. */
  | { type: "body_sp"; value: number }
  /** Dados extras no ataque desarmado, em número de d6 (ex.: 1 → +1d6). */
  | { type: "unarmed_damage"; value: number }
  /** Bônus no MOVE efetivo (exibido na ficha; nenhuma rolagem usa MOVE hoje). */
  | { type: "move"; value: number }
  /** Bônus/penalidade em TODO teste físico, no mesmo espírito das Critical Injuries. */
  | { type: "all_physical"; value: number };

/** Um estágio de um cyberware ativável. O botão percorre os estágios e volta para o inativo. */
export type ActivationStage = {
  /** Nome exibido no botão enquanto o estágio estiver ativo. */
  name: string;
  /** Modificadores aplicados enquanto o cyberware está neste estágio. */
  modifiers?: CyberwareModifier[];
  /** true = enquanto ativo, ignora a penalidade de Seriously Wounded (Pain Editor). */
  ignoreWoundPenalty?: boolean;
};

/** Cyberware ativável: efeito que o jogador liga/desliga na ficha (fase 2 — sem contador de rodada). */
export type CyberwareActivation = {
  /** Rótulo do botão de ativação; quando ausente usa o nome do item. */
  label?: string;
  /** Estágios percorridos pelo botão; sem estágio ativo = inativo. */
  stages: ActivationStage[];
};

/** Habilidade disparada por botão enquanto o cyberware está ativo (uso é manual, sem contador). */
export type CyberwareAction =
  | { type: "heal"; label: string; amount: number }
  | { type: "reroll_initiative"; label: string };

export interface CatalogItem { id: string; name: string; category: ItemCategory; subcategory?: string; price: number; description?: string; effects?: string[]; quantity?: number; /** HP restaurados ao usar o item. */ hpRestore?: number; /** Item estabiliza personagem Mortally Wounded (encerra Death Saves). */ stabilizes?: boolean; /** ID do item que precisa estar instalado para usar/equipar este. */ requires?: string; /** Efeitos numéricos aplicados pelo motor enquanto o item estiver instalado/equipado. */ modifiers?: CyberwareModifier[]; /** Efeito que o jogador liga/desliga na ficha (toggle de ativação). */ activation?: CyberwareActivation; /** Habilidade disparada por botão enquanto o item estiver ativo. */ action?: CyberwareAction; [key: string]: unknown; }
type ItemCatalog = { version: string; source: string; items: CatalogItem[] };
export const itemCatalog = rawCatalog as ItemCatalog;
export const catalogItems = itemCatalog.items;
export function getCatalogItem(itemId: string): CatalogItem | undefined { return catalogItems.find((item) => item.id === itemId); }