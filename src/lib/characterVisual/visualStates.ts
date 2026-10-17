/**
 * Catálogo central de estados visuais de combate (SOMENTE módulo puro).
 *
 * Este é o único lugar que define quais estados visuais existem. Componentes,
 * serviços e persistência importam daqui — nenhum arquivo espalha strings de
 * estado arbitrárias. O catálogo é extensível: acrescente a constante em
 * `COMBAT_VISUAL_STATES` e o rótulo em `COMBAT_VISUAL_STATE_CATALOG`; o resto
 * do sistema (grade da tela de personalização, fallbacks do renderizador)
 * acompanha automaticamente.
 *
 * A imagem `IDLE` é a única obrigatória: personagens legados sem nenhuma
 * personalização continuam funcionando com o fallback genérico.
 */

export const COMBAT_VISUAL_STATES = [
  "IDLE",
  "ATTACK",
  "DODGE",
  "HIT",
  "DEFEATED",
  "DEATH",
  "AIM",
  "SHOOT",
  "MELEE_ATTACK",
  "RELOAD",
] as const;

export type CombatVisualState = (typeof COMBAT_VISUAL_STATES)[number];

export interface CombatVisualStateDefinition {
  readonly id: CombatVisualState;
  /** Rótulo curto para a interface (pt-BR). */
  readonly label: string;
  /** Explicação curta do que a imagem representa. */
  readonly hint: string;
  /**
   * Obrigatório para concluir a configuração visual do personagem.
   * Ausente = opcional (somente `IDLE` é obrigatório hoje).
   */
  readonly required?: boolean;
  /**
   * Estado que só existe quando as regras de jogo o definem efetivamente
   * (ex.: DEATH depende da morte ser um estado distinto de DEFEATED).
   */
  readonly ruleGated?: boolean;
}

/** Ordem de exibição da grade de personalização. */
export const COMBAT_VISUAL_STATE_CATALOG: readonly CombatVisualStateDefinition[] = [
  {
    id: "IDLE",
    label: "Prontidão",
    hint: "Corpo inteiro em posição neutra. Usada como fallback para estados sem imagem própria.",
    required: true,
  },
  { id: "ATTACK", label: "Ataque", hint: "Ataque genérico à distância ou corpo a corpo." },
  { id: "DODGE", label: "Esquiva", hint: "Personagem em movimento de esquiva." },
  { id: "HIT", label: "Recebendo dano", hint: "Personagem atingido." },
  { id: "DEFEATED", label: "Incapacitado", hint: "Derrotado, inconsciente ou fora de combate." },
  {
    id: "DEATH",
    label: "Morto",
    hint: "Somente quando a mesa tratar a morte como estado distinto da incapacitação.",
    ruleGated: true,
  },
  { id: "AIM", label: "Mirando", hint: "Personagem mirando em um alvo." },
  { id: "SHOOT", label: "Disparando", hint: "Personagem efetuando um disparo." },
  { id: "MELEE_ATTACK", label: "Corpo a corpo", hint: "Ataque melee, golpe de lâmina ou soco." },
  { id: "RELOAD", label: "Recarregando", hint: "Personagem recarregando a arma." },
];

export const COMBAT_VISUAL_STATE_BY_ID: Readonly<Record<CombatVisualState, CombatVisualStateDefinition>> =
  Object.fromEntries(
    COMBAT_VISUAL_STATE_CATALOG.map((definition) => [definition.id, definition]),
  ) as Record<CombatVisualState, CombatVisualStateDefinition>;

/** Estados obrigatórios para concluir a configuração visual. */
export const REQUIRED_VISUAL_STATES: readonly CombatVisualState[] = COMBAT_VISUAL_STATE_CATALOG
  .filter((definition) => definition.required === true)
  .map((definition) => definition.id);

/** Estado usado pelo renderizador quando nenhum evento de combate se aplica. */
export const DEFAULT_COMBAT_VISUAL_STATE: CombatVisualState = "IDLE";

const STATE_IDS = new Set<string>(COMBAT_VISUAL_STATES);

export function isCombatVisualState(value: unknown): value is CombatVisualState {
  return typeof value === "string" && STATE_IDS.has(value);
}

export function isRequiredVisualState(state: CombatVisualState): boolean {
  return COMBAT_VISUAL_STATE_BY_ID[state]?.required === true;
}

/** Posição ordenada do estado no catálogo (estados desconhecidos vão ao fim). */
export function catalogOrderOf(state: CombatVisualState): number {
  const index = COMBAT_VISUAL_STATES.indexOf(state);
  return index === -1 ? COMBAT_VISUAL_STATES.length : index;
}
