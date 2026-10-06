/**
 * F1.13.4/F1.13.5 — **ficha Mesa-aware**: a camada que diz à `CharacterSheet` quando a
 * Mesa é a autoridade e roteia o clique em "✚ Usar" para o servidor.
 *
 * Sete peças PURAS (sem React, sem rede, sem storage), para que a detecção,
 * a leitura e o roteamento possam ser testados sem renderizar a ficha:
 *
 *   `sheetMesaMode()`             → `"local" | "mesa-combat"` — quem manda;
 *   `playerAttackUnavailable()`   → desdobramento do modo (F1.13.5): em
 *                                   `"mesa-combat"` sem contexto de ataque da
 *                                   Mesa, o ataque é recusado — nunca volta
 *                                   pro rolo local;
 *   `linkedCombatant()`           → qual combatente é ESTE personagem;
 *   `trackedSupplyIds()`          → leitura do que a mochila da Mesa acompanha;
 *   `healingButtonState()`        → regra do botão "✚ Usar" (inclusive o
 *                                   bloqueio de item que a Mesa não tem);
 *   `localHpRefusal()`            → recusa dos fluxos locais de HP/First Aid/
 *                                   Death Save durante o combate;
 *   `performHealingItemClick()`   → rota do clique no item de cura:
 *                                   sem contexto Mesa → fluxo local de sempre;
 *                                   com contexto Mesa → `POST /combat/item-heal`
 *                                   e NENHUMA mutação local (nem item, nem HP);
 *   `performInitiativeRoll()`     → rota do clique em "🎲 Rolar" (F1.14.2):
 *                                   sem contexto Mesa → fluxo local de sempre;
 *                                   com contexto Mesa → rolagem local + POST da
 *                                   intenção + refresh, SEM `update()`.
 *
 * Nada aqui cria regra de cura, regra de HP, tabela ou sistema de membership.
 * O valor da cura continua sendo do servidor (`getSupplyHealAmount` na
 * `commit_mesa_item_heal_resolution`) e a detecção vem do `membershipStore` +
 * `useMesaState` que a ficha já usa.
 */
import { resolveSupplyItemId } from "@/data/supplyItems";
import { MesaApiError, type MesaItemHealResult } from "@/lib/mesa/client";
import type { MesaDeathSaveResult } from "@/lib/mesa/client";
import type { MesaCombatant, MesaState, PlayerInitiativeOutcome } from "@/lib/mesa/types";
import type { InitiativeRollResult } from "@/lib/initiative";
import type { Character } from "@/types/character";

/**
 * Como a ficha está operando agora.
 *
 *  • `"local"`      → sem Mesa, Mesa sem combate, Mesa encerrada, Mestre ou
 *                     personagem não vinculado: o comportamento atual da ficha,
 *                     idêntico ao standalone;
 *  • `"mesa-combat"` → combate ativo da Mesa com ESTE personagem dentro:
 *                     HP/armor/ammo/CI/supplies e uso de item mandam no servidor.
 */
export type SheetMesaMode = "local" | "mesa-combat";

/**
 * Estado que não pode ser escrito pela ficha enquanto a Mesa está resolvendo
 * um combate. A lista é deliberadamente sobre estado, não sobre componentes:
 * ela evita que cada handler invente sua própria leitura de autoridade.
 */
export type MesaAuthoritativeMutation =
  | "hp"
  | "inventory"
  | "ammo"
  | "armor"
  | "critical-injuries"
  | "death-state"
  | "action-economy"
  | "attack-result"
  | "damage-result"
  | "conditions"
  | "movement";

const mesaMutationLabels: Record<MesaAuthoritativeMutation, string> = {
  hp: "o HP",
  inventory: "o inventário",
  ammo: "a munição",
  armor: "a armadura",
  "critical-injuries": "as Critical Injuries",
  "death-state": "o estado de morte",
  "action-economy": "a economia de ações",
  "attack-result": "o resultado do ataque",
  "damage-result": "o resultado do dano",
  conditions: "as condições de combate",
  movement: "o movimento",
};

/**
 * Recusa uma escrita local de estado autoritativo. `mode` vem diretamente do
 * `sheetMesaMode()`; este helper não reavalia sessão, papel ou combatente.
 */
export function localCombatMutationRefusal(
  mode: SheetMesaMode,
  mutation: MesaAuthoritativeMutation,
): string | null {
  if (mode !== "mesa-combat") return null;
  return `Durante o combate da Mesa, ${mesaMutationLabels[mutation]} é definido pelo servidor — esta ação foi bloqueada.`;
}

export interface SheetMesaModeInput {
  state: MesaState | null;
  characterId: string | null;
}

/**
 * O combatente que representa ESTE personagem na Mesa, do ponto de vista de
 * quem está olhando: mesma `characterId` E mesmo `participantId` (não basta o
 * nome bater — dois jogadores podem ter o mesmo nome de personagem).
 */
export function linkedCombatant(
  state: MesaState | null,
  characterId: string | null,
): MesaCombatant | null {
  if (!state || !characterId || !state.viewer.participantId) return null;
  return (
    state.combatants.find(
      (entry) =>
        entry.kind === "character" &&
        entry.characterId === characterId &&
        entry.participantId === state.viewer.participantId,
    ) ?? null
  );
}

/**
 * Decide o modo da ficha. **Se algo não puder ser afirmado com segurança, a
 * resposta é `"local"`** — nunca se inventa autoridade.
 *
 * Só `"mesa-combat"` quando TODAS as afirmações valem:
 *  1. há estado da Mesa (sem estado → sem autoridade);
 *  2. a sessão não terminou (`finished` = Mesa stale, F1.12.8);
 *  3. quem olha é jogadora (Mestre nunca é afetado);
 *  4. há um combate `active`;
 *  5. ESTE personagem é um combatente dentro da Mesa (`linkedCombatant`).
 */
export function sheetMesaMode(input: SheetMesaModeInput): SheetMesaMode {
  const { state, characterId } = input;
  if (!state || !characterId) return "local";
  if (state.session.status === "finished") return "local";
  if (state.viewer.role !== "player" || !state.viewer.participantId) return "local";
  if (state.combat?.status !== "active") return "local";
  return linkedCombatant(state, characterId) ? "mesa-combat" : "local";
}

/**
 * F1.13.5 — o bloqueio de ataque da ficha (`playerAttackUnavailable` na
 * `CharacterSheet`): **um desdobramento de `sheetMesaMode()`**, nunca uma
 * segunda detecção.
 *
 * Só é `true` quando a ficha JÁ está em `"mesa-combat"` (a Mesa é a autoridade
 * de quem manda no combate) e o contexto de ataque da Mesa não pôde ser
 * montado — aí o ataque é recusado em voz alta ("Combate da Mesa indisponível")
 * em vez de a ficha rolar localmente um combate que é da Mesa.
 *
 * Fora do modo Mesa — sem Mesa, Mesa sem combate, sessão encerrada/stale,
 * Mestre ou personagem não vinculado — devolve `false`, ou seja, o ataque
 * segue exatamente o fluxo local de sempre. A decisão inteira mora em
 * `sheetMesaMode()`; os `viewer.role`/`combat.status`/vinculação NÃO são
 * relidos aqui.
 */
export function playerAttackUnavailable(
  input: SheetMesaModeInput & { hasAttackSetup: boolean },
): boolean {
  return sheetMesaMode(input) === "mesa-combat" && !input.hasAttackSetup;
}

/**
 * Ids estáveis que a mochila da Mesa acompanha para este combatente.
 *
 * Camada de LEITURA: a ficha não ganha uma segunda fonte de verdade — é só o
 * "este item pertence à Mesa?" que o botão precisa saber para não deixar o
 * jogador consumir localmente algo que o servidor controla.
 */
export function trackedSupplyIds(combatant: MesaCombatant | null): ReadonlySet<string> {
  const inventory = combatant?.supplies?.inventory;
  if (!Array.isArray(inventory)) return new Set<string>();
  const ids = new Set<string>();
  for (const entry of inventory) {
    const id = resolveSupplyItemId(entry);
    if (id) ids.add(id);
  }
  return ids;
}

/** Aviso mostrado no painel de inventário (mesmo formato do fluxo local). */
export interface HealingNotice {
  text: string;
  isError: boolean;
}

/** Resultado do fluxo local legado (`applyHealingItem`), já calculado. */
export type HealingLocalOutcome = { error: string } | { text: string; character: Character };

/** Contexto da Mesa: presente ⇔ a ficha está em modo `"mesa-combat"`. */
export interface MesaHealingContext {
  /** Anti-spam: um uso por vez enquanto o POST está em voo. */
  isBusy(): boolean;
  setBusy(busy: boolean): void;
  /** `POST /api/mesa/[id]/combat/item-heal` — a intenção apenas. */
  useItem(itemId: string): Promise<MesaItemHealResult>;
}

/** Contexto passado pela `CharacterToolkit` para a `CharacterSheet`. */
export interface PlayerHealingSetup {
  /** A mochila da Mesa acompanha este item (id estável presente em `supplies`)? */
  isTracked(itemId: string): boolean;
  /** Envia a intenção e devolve a resolução atômica do servidor. */
  useItem(itemId: string): Promise<MesaItemHealResult>;
}

export interface PlayerDeathSaveSetup {
  isBusy(): boolean;
  setBusy(busy: boolean): void;
  roll(): Promise<MesaDeathSaveResult>;
}

/**
 * Estado do botão "✚ Usar" — pura, para que a regra "item que a Mesa não
 * acompanha não pode ser consumido localmente" seja testável sem renderizar a
 * ficha (o harness de testes não resolve `next/link`).
 */
export interface HealingButtonState {
  disabled: boolean;
  title: string;
  label: string;
}

export function healingButtonState(input: {
  healAmount: number;
  isDead: boolean;
  atFullHp: boolean;
  busy: boolean;
  /** Presente ⇔ modo Mesa; ausente ⇔ ficha local, onde tudo segue habilitado. */
  mesa?: Pick<PlayerHealingSetup, "isTracked">;
  itemId: string;
}): HealingButtonState {
  const tracked = input.mesa ? input.mesa.isTracked(input.itemId) : true;
  return {
    disabled: input.isDead || input.atFullHp || input.busy || !tracked,
    title: tracked ? `Restaura ${input.healAmount} HP` : "Este item não está na mochila da Mesa.",
    label: input.busy && input.mesa ? "Usando…" : `✚ Usar (+${input.healAmount} HP)`,
  };
}

export interface HealingFlowDeps {
  /** ID estável do item (nunca o rótulo) — F1.13.2. */
  itemId: string;
  /** Presente ⇔ modo Mesa; ausente ⇔ fluxo local de sempre. */
  mesa?: MesaHealingContext;
  /** Fechamento sobre a ficha atual: `applyHealingItem(character, id)`. */
  local(): HealingLocalOutcome;
  /** Escrita da ficha local — **nunca** chamado no modo Mesa. */
  update(character: Character): void;
  notify(notice: HealingNotice): void;
}

/** Mensagem de erro apropriada: nunca vaza erro de rede/genérico em inglês. */
export function healingErrorMessage(caught: unknown): string {
  if (caught instanceof MesaApiError) return caught.message;
  return "Não foi possível usar o item. Nada foi consumido e seu HP não mudou.";
}

/**
 * Mensagem de recusa quando um fluxo **local de HP** (First Aid com rolagem,
 * First Aid → 1 HP, Death Save) é acionado durante o combate da Mesa — ou
 * `null` quando o fluxo local segue liberado.
 *
 * Esses fluxos faziam `roll local → decrement → onUpdate`; com a Mesa em
 * combate, a sincronização desfazia o HP e a rolagem com medkit consumia o
 * item sem curar nada. Recusar em voz alta é o mesmo `mesa_authoritative` que
 * o servidor já aplica ao HP — não é uma segunda regra de cura nem uma regra
 * de Death Save nova.
 */
export function localHpRefusal(playerHealing: PlayerHealingSetup | undefined): string | null {
  return playerHealing
    ? "Durante o combate da Mesa o HP é definido pelo servidor — esta ação roda fora do combate."
    : null;
}

/**
 * Um clique no "✚ Usar" da ficha.
 *
 * **Modo local** (ficha standalone ou Mesa sem combate): roda o fluxo de
 * sempre, na mesma ordem de sempre (aviso → `update`).
 *
 * **Modo Mesa**: só existe o caminho do servidor. Nenhum caminho muta o
 * personagem localmente — nem o item, nem o HP. O estado novo chega depois
 * pela sincronização da Mesa (`syncMesaCharacterState` após `refresh`);
 * se o servidor recusar, o estado local permanece intacto.
 *
 * Retorna o aviso exibido, ou `null` quando o clique foi ignorado (já há um
 * uso em andamento — proteção contra spam).
 */
export async function performHealingItemClick(deps: HealingFlowDeps): Promise<HealingNotice | null> {
  if (!deps.mesa) {
    const outcome = deps.local();
    if ("error" in outcome) {
      const notice: HealingNotice = { text: outcome.error, isError: true };
      deps.notify(notice);
      return notice;
    }
    const notice: HealingNotice = { text: outcome.text, isError: false };
    deps.notify(notice);
    deps.update(outcome.character);
    return notice;
  }

  const mesa = deps.mesa;
  if (mesa.isBusy()) return null;
  mesa.setBusy(true);
  try {
    const result = await mesa.useItem(deps.itemId);
    const notice: HealingNotice = {
      text: `${result.itemName} usado: +${result.restored} HP (${result.hpAfter}/${result.hpMax}) · restam ${result.quantityAfter}`,
      isError: false,
    };
    deps.notify(notice);
    return notice;
  } catch (caught) {
    const notice: HealingNotice = { text: healingErrorMessage(caught), isError: true };
    deps.notify(notice);
    return notice;
  } finally {
    mesa.setBusy(false);
  }
}

// ---------------------------------------------------------------------------
// F1.14.2 — Player Initiative Gateway (rota do clique em "🎲 Rolar")
// ---------------------------------------------------------------------------

/** Aviso da seção de Iniciativa — mesmo formato do aviso de cura. */
export interface InitiativeNotice {
  text: string;
  isError: boolean;
}

/** Resultado da rolagem local já resolvida (personagem inclui o consumo da peça). */
export type InitiativeLocalOutcome =
  | { error: string }
  | { result: InitiativeRollResult; character: Character };

/**
 * Contexto da Mesa: presente ⇔ a ficha está em modo `"mesa-combat"`.
 *
 * Só isto sai do navegador: o RNG da ficha roda LOCALMENTE e o que vai pro
 * servidor é a intenção `{ actorCombatantId, initiative }`. O servidor valida,
 * grava em `mesa_combatants.initiative` e devolve o valor autoritativo — a
 * ficha NÃO escreve nada em `character`.
 */
export interface MesaInitiativeContext {
  /** Anti-spam: um registro por vez enquanto o POST está em voo. */
  isBusy(): boolean;
  setBusy(busy: boolean): void;
  /** Combatante do PARTICIPANTE — este gateway não registra de outro. */
  combatantId: string | null;
  /** `POST /api/mesa/[id]/combat/initiative` — só a intenção, nunca `initiativeOrder`. */
  register(input: { actorCombatantId: string; initiative: number }): Promise<PlayerInitiativeOutcome & { committed: boolean }>;
  /**
   * Depois do 200: puxa o estado novo da Mesa (`GET /api/mesa/[id]`). O valor
   * exibido na ficha vem daí (`syncMesaCharacterState`), não desta chamada.
   */
  refresh(): Promise<void>;
}

export interface InitiativeFlowDeps {
  /** Presente ⇔ modo Mesa; ausente ⇔ fluxo local de sempre. */
  mesa?: MesaInitiativeContext;
  /** Rola com o RNG da ficha e devolve o personagem resultante (peça consumida). */
  local(): InitiativeLocalOutcome;
  /** Escrita da ficha local — **nunca** chamada no modo Mesa. */
  update(character: Character): void;
  /** Indicador do botão: `diceRoll` durante a rolagem, `null` para limpar. */
  showRoll(diceRoll: number | null): void;
  /** Resultado exibido ("2d10 + 7 = 15") — só no fluxo LOCAL. */
  showResult(result: InitiativeRollResult): void;
  notify(notice: InitiativeNotice): void;
}

/** Mensagem de erro apropriada: nunca vaza erro de rede/genérico em inglês. */
export function initiativeErrorMessage(caught: unknown): string {
  if (caught instanceof MesaApiError) return caught.message;
  return "Não foi possível registrar a iniciativa. O valor anterior continua valendo.";
}

/**
 * Um clique em "🎲 Rolar" da ficha.
 *
 * **Modo local** (ficha standalone, Mesa sem combate, Mestre, personagem não
 * vinculado): o fluxo de sempre, na mesma ordem de sempre — rolagem → indicador
 * → `update`. Nada muda fora de `mesa-combat`.
 *
 * **Modo Mesa**: a rolagem acontece no navegador (o RNG continua sendo o da
 * ficha), mas o resultado NÃO é gravado em `character` — a intenção vai pro
 * servidor e o valor exibido passa a vir do estado da Mesa
 * (`character.combat.initiative`, escrito por `syncMesaCharacterState`).
 * NENHUMA `update()` aqui: em falha, o estado local anterior permanece intacto
 * e o erro é exibido.
 *
 * Retorna o aviso exibido, ou `null` quando o clique foi ignorado (já há um
 * registro em andamento — proteção contra spam) ou quando não há aviso a ver.
 */
export async function performInitiativeRoll(deps: InitiativeFlowDeps): Promise<InitiativeNotice | null> {
  if (!deps.mesa) {
    const outcome = deps.local();
    if ("error" in outcome) {
      const notice: InitiativeNotice = { text: outcome.error, isError: true };
      deps.notify(notice);
      return notice;
    }
    deps.showRoll(outcome.result.diceRoll);
    deps.showResult(outcome.result);
    deps.update(outcome.character);
    return null;
  }

  const mesa = deps.mesa;
  if (mesa.isBusy()) return null;
  if (!mesa.combatantId) {
    const notice: InitiativeNotice = {
      text: "Personagem não vinculado à Mesa: a iniciativa não foi registrada.",
      isError: true,
    };
    deps.notify(notice);
    return notice;
  }

  const outcome = deps.local();
  if ("error" in outcome) {
    const notice: InitiativeNotice = { text: outcome.error, isError: true };
    deps.notify(notice);
    return notice;
  }

  mesa.setBusy(true);
  deps.showRoll(outcome.result.diceRoll);
  try {
    await mesa.register({ actorCombatantId: mesa.combatantId, initiative: outcome.result.total });
    await mesa.refresh();
    const notice: InitiativeNotice = { text: `Iniciativa registrada (${outcome.result.total}).`, isError: false };
    deps.notify(notice);
    return notice;
  } catch (caught) {
    const notice: InitiativeNotice = { text: initiativeErrorMessage(caught), isError: true };
    deps.notify(notice);
    return notice;
  } finally {
    mesa.setBusy(false);
    deps.showRoll(null);
  }
}
