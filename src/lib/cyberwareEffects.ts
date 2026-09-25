import { catalogItems, getCatalogItem, type ActivationStage, type CatalogItem, type CyberwareAction, type CyberwareModifier } from "@/data/items";
import type { AttackModifier } from "@/types/attack";
import type { Character, CyberwareItem } from "@/types/character";

/** Limite de aprimoramentos ópticos aceitos por um Cybereye ("Pode receber até 2 aprimoramentos ópticos"). */
const CYBEREYE_OPTICAL_SLOTS = 2;

/** Resolve o item do catálogo de um cyberware já instalado.
 * Prefere o `catalogItemId` persistido; o fallback por nome cobre fichas salvas
 * antes de passarmos a guardar a referência no CyberwareItem. */
export function resolveInstalledCyberwareItem(cyberware: CyberwareItem): CatalogItem | undefined {
  if (cyberware.catalogItemId) {
    const item = getCatalogItem(cyberware.catalogItemId);
    if (item) return item;
  }
  return catalogItems.find((item) => item.category === "cyberware" && item.name === cyberware.name);
}

/** IDs de catálogo de todos os cyberwares instalados no personagem. */
export function getInstalledCyberwareIds(character: Pick<Character, "cyberware">): string[] {
  return character.cyberware
    .map((cyberware) => resolveInstalledCyberwareItem(cyberware)?.id)
    .filter((id): id is string => Boolean(id));
}

/** true quando o personagem tem o cyberware de catálogo `catalogItemId` instalado. */
export function hasInstalledCyberware(character: Pick<Character, "cyberware">, catalogItemId: string): boolean {
  return getInstalledCyberwareIds(character).includes(catalogItemId);
}

/** true quando o personagem tem um cyberarm instalado (Gorilla Arms, Mantis Blades, Cyberarm...).
 * É a condição do piso de 2d6 no dano de Brawling e Artes Marciais. */
export function hasInstalledCyberarm(character: Pick<Character, "cyberware">): boolean {
  return character.cyberware.some((cyberware) => resolveInstalledCyberwareItem(cyberware)?.subcategory === "cyberarm");
}

/** Modificador estruturado carregado do nome do cyberware que o fornece. */
export type SourcedCyberwareModifier = CyberwareModifier & { source: string };

/** Todos os modificadores ativos: passivos + o estágio de ativação ligado (fase 2). */
export function getCyberwareModifiers(character: Pick<Character, "cyberware">): SourcedCyberwareModifier[] {
  return character.cyberware.flatMap((cyberware) => {
    const item = resolveInstalledCyberwareItem(cyberware);
    if (!item) return [];
    const stage = getActiveStage(cyberware, item);
    const modifiers = [...(item.modifiers ?? []), ...(stage?.modifiers ?? [])];
    return modifiers.map((modifier) => ({ ...modifier, source: item.name }));
  });
}

/** Estágio de ativação atualmente ligado de uma peça instalada (undefined = inativo). */
function getActiveStage(cyberware: CyberwareItem, item: CatalogItem): ActivationStage | undefined {
  if (cyberware.activeStage === undefined) return undefined;
  return item.activation?.stages[cyberware.activeStage];
}

export type CyberwareSkillModifier = { skillId: string; value: number; source: string };

/** Bônus de perícia (Gorilla Arms → brawling, Audio Filter → perception, ...). */
export function getCyberwareSkillModifiers(character: Pick<Character, "cyberware">): CyberwareSkillModifier[] {
  return getCyberwareModifiers(character)
    .filter((modifier): modifier is SourcedCyberwareModifier & { type: "skill"; skill: string; value: number } => modifier.type === "skill")
    .map((modifier) => ({ skillId: modifier.skill, value: modifier.value, source: modifier.source }));
}

/** Bônus de perícia acumulado para uma perícia específica. */
export function getCyberwareSkillModifierFor(character: Pick<Character, "cyberware">, skillId: string): CyberwareSkillModifier[] {
  return getCyberwareSkillModifiers(character).filter((modifier) => modifier.skillId === skillId);
}

/** Modificadores de ataque vindos do cyberware (Targeting Scope em ataques à distância,
 * Smart Link com armas smart, bônus de perícia como o +2 Briga do Gorilla Arms). */
export function getCyberwareAttackModifiers(
  character: Pick<Character, "cyberware">,
  options: { ranged: boolean; smart: boolean; skillId?: string },
): AttackModifier[] {
  const modifiers: AttackModifier[] = [];
  for (const modifier of getCyberwareModifiers(character)) {
    if (modifier.type === "attack_ranged" && options.ranged) {
      modifiers.push({ source: `${modifier.source} (longa distância)`, value: modifier.value });
    }
    if (modifier.type === "attack_smart" && options.smart) {
      modifiers.push({ source: `${modifier.source} (arma smart)`, value: modifier.value });
    }
  }
  if (options.skillId) {
    for (const skill of getCyberwareSkillModifierFor(character, options.skillId)) {
      modifiers.push({ source: `${skill.source} (${skill.skillId})`, value: skill.value });
    }
  }
  return modifiers;
}

/** Modificadores de Evasão vindos do cyberware. */
export function getCyberwareEvasionModifiers(character: Pick<Character, "cyberware">): AttackModifier[] {
  return getCyberwareModifiers(character)
    .filter((modifier): modifier is SourcedCyberwareModifier & { type: "evasion"; value: number } => modifier.type === "evasion")
    .map((modifier) => ({ source: modifier.source, value: modifier.value }));
}

/** Modificadores de Iniciativa vindos do cyberware. */
export function getCyberwareInitiativeModifiers(character: Pick<Character, "cyberware">): AttackModifier[] {
  return getCyberwareModifiers(character)
    .filter((modifier): modifier is SourcedCyberwareModifier & { type: "initiative"; value: number } => modifier.type === "initiative")
    .map((modifier) => ({ source: modifier.source, value: modifier.value }));
}

/** SP extra do corpo. Subdermal Armor/Skin Weave não acumulam com armadura: vale o maior valor. */
export function getCyberwareBodySP(character: Pick<Character, "cyberware">): number {
  return getCyberwareModifiers(character).reduce(
    (highest, modifier) => (modifier.type === "body_sp" ? Math.max(highest, modifier.value) : highest),
    0,
  );
}

/** Dados extras no ataque desarmado (Gorilla Arms: +1d6 → 1), com a peça que os fornece. */
export function getCyberwareUnarmedDamageModifiers(character: Pick<Character, "cyberware">): SourcedCyberwareModifier[] {
  return getCyberwareModifiers(character).filter(
    (modifier): modifier is SourcedCyberwareModifier & { type: "unarmed_damage"; value: number } => modifier.type === "unarmed_damage",
  );
}

/** Dados extras no ataque desarmado (Gorilla Arms: +1d6 → 1). */
export function getCyberwareUnarmedDamageDice(character: Pick<Character, "cyberware">): number {
  return getCyberwareUnarmedDamageModifiers(character).reduce((total, modifier) => total + modifier.value, 0);
}

/** Efeito "todo teste físico" vindo de cyberware ativado (Adrenaline Booster no rescaldo). */
export function getCyberwarePhysicalModifiers(character: Pick<Character, "cyberware">): SourcedCyberwareModifier[] {
  return getCyberwareModifiers(character).filter(
    (modifier): modifier is SourcedCyberwareModifier & { type: "all_physical"; value: number } => modifier.type === "all_physical",
  );
}

/** Bônus de MOVE efetivo de cyberware ativado (ex.: Adrenaline Booster → +2). */
export function getCyberwareMoveModifier(character: Pick<Character, "cyberware">): number {
  return getCyberwareModifiers(character).reduce(
    (total, modifier) => (modifier.type === "move" ? total + modifier.value : total),
    0,
  );
}

/** true quando algum cyberware ativado está ignorando a penalidade de Seriously Wounded (Pain Editor). */
export function ignoresWoundPenalty(character: Pick<Character, "cyberware">): boolean {
  return character.cyberware.some((cyberware) => {
    const item = resolveInstalledCyberwareItem(cyberware);
    if (!item) return false;
    return getActiveStage(cyberware, item)?.ignoreWoundPenalty === true;
  });
}

/** SP efetivo de um local de impacto: armadura equipada e cyberware não acumulam, vale o maior. */export function getEffectiveArmorSP(character: Pick<Character, "combat" | "cyberware">, slot: "head" | "body"): number {
  const wornArmor = character.combat.armor[slot] ?? 0;
  const cyberwareSP = slot === "body" ? getCyberwareBodySP(character) : 0;
  return Math.max(wornArmor, cyberwareSP);
}

/** Erro de instalação/equipamento por requisito não atendido. */
export type CyberwareRequirementError = { error: string };

/** Valida se um cyberware pode ser instalado: pré-requisito instalado e slots ocupados. */
export function validateCyberwareInstall(
  character: Pick<Character, "cyberware">,
  item: CatalogItem,
): CyberwareRequirementError | null {
  if (item.requires && !hasInstalledCyberware(character, item.requires)) {
    const required = getCatalogItem(item.requires);
    return { error: `Requer ${required?.name ?? item.requires} instalado antes deste item.` };
  }
  if (item.requires === "cybereye") {
    const usedSlots = character.cyberware.filter((cyberware) => resolveInstalledCyberwareItem(cyberware)?.requires === "cybereye").length;
    if (usedSlots >= CYBEREYE_OPTICAL_SLOTS) {
      return { error: `Cybereye já está com os ${CYBEREYE_OPTICAL_SLOTS} aprimoramentos ópticos ocupados.` };
    }
  }
  return null;
}

/** Valida se uma arma do catálogo pode ser equipada (ex.: armas smart exigem Smart Weapon Link). */
export function validateWeaponEquip(
  character: Pick<Character, "cyberware">,
  item: CatalogItem,
): CyberwareRequirementError | null {
  if (!item.requires) return null;
  if (hasInstalledCyberware(character, item.requires)) return null;
  const required = getCatalogItem(item.requires);
  return { error: `Requer ${required?.name ?? item.requires} instalado para usar esta arma.` };
}

/** true quando o item do catálogo é uma arma smart (exige Smart Weapon Link). */
export function isSmartWeapon(item: Pick<CatalogItem, "subcategory" | "requires">): boolean {
  return item.subcategory === "smart" || item.requires === "smart_link";
}

/* -------------------------------------------------------------------------- *
 * Ativação manual (fase 2): toggle por peça, sem contador de rodada.
 * -------------------------------------------------------------------------- */

/** Controles de uma peça instalada para a UI (toggle e ação). */
export type CyberwareControl = {
  cyberwareId: string;
  name: string;
  effects: string[];
  isBorgware?: boolean;
  activation?: {
    /** Rótulo do botão (nome do item quando o catálogo não define). */
    label: string;
    /** Nomes dos estágios, na ordem em que o botão os percorre. */
    stages: string[];
    /** Estágio ativo ou undefined quando inativo. */
    activeStage: number | undefined;
  };
  action?: CyberwareAction;
  /** true quando a peça está ligada (é a trava da ação). */
  actionEnabled: boolean;
};

/** Lista de peças instaladas com efeitos de texto + controles de ativação. */
export function getInstalledCyberwareControls(character: Pick<Character, "cyberware">): CyberwareControl[] {
  return character.cyberware.map((cyberware) => {
    const item = resolveInstalledCyberwareItem(cyberware);
    const activation = item?.activation;
    const activeStage =
      activation && cyberware.activeStage !== undefined && activation.stages[cyberware.activeStage]
        ? cyberware.activeStage
        : undefined;
    return {
      cyberwareId: cyberware.id,
      name: cyberware.name,
      effects: item?.effects ?? [],
      isBorgware: cyberware.isBorgware,
      activation: activation
        ? { label: activation.label ?? item.name, stages: activation.stages.map((stage) => stage.name), activeStage }
        : undefined,
      action: item?.action,
      actionEnabled: activeStage !== undefined,
    };
  });
}

/** Avança o toggle: inativo → estágio 0 → estágio 1 → ... → inativo. */
export function toggleCyberwareActivation(character: Character, cyberwareId: string): Character {
  return {
    ...character,
    cyberware: character.cyberware.map((cyberware) => {
      if (cyberware.id !== cyberwareId) return cyberware;
      const item = resolveInstalledCyberwareItem(cyberware);
      const stages = item?.activation?.stages ?? [];
      if (!stages.length) return cyberware;
      const current = cyberware.activeStage;
      const next = current === undefined ? 0 : current + 1 >= stages.length ? undefined : current + 1;
      return next === undefined ? { ...cyberware, activeStage: undefined } : { ...cyberware, activeStage: next };
    }),
  };
}

/** Desliga uma peça (usada depois de consumir uma ação, ex.: repetir Iniciativa). */
export function deactivateCyberware(character: Character, cyberwareId: string): Character {
  return {
    ...character,
    cyberware: character.cyberware.map((cyberware) =>
      cyberware.id === cyberwareId ? { ...cyberware, activeStage: undefined } : cyberware,
    ),
  };
}

/** Ações numéricas disparadas por botão. `reroll_initiative` é da UI e não passa por aqui. */
export type CyberwareActionOutcome = { character: Character; healed: number } | { error: string };

export function runCyberwareAction(character: Character, cyberwareId: string): CyberwareActionOutcome {
  const cyberware = character.cyberware.find((item) => item.id === cyberwareId);
  if (!cyberware) return { error: "Cyberware não encontrado." };
  const item = resolveInstalledCyberwareItem(cyberware);
  const action = item?.action;
  if (!action) return { error: "Esta peça não tem ação disponível." };
  if (cyberware.activeStage === undefined) return { error: `Ative ${item.name} antes de usar esta ação.` };
  if (action.type !== "heal") return { error: "Ação não numérica: use o botão correspondente na ficha." };

  const hp = character.combat.hp;
  const healed = Math.max(0, Math.min(action.amount, hp.max - hp.current));
  return {
    character: {
      ...character,
      combat: { ...character.combat, hp: { ...hp, current: hp.current + healed } },
    },
    healed,
  };
}
