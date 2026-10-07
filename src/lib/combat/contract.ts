/**
 * F1.1 — CONTRATO DE COMBATE (tipos puros).
 *
 * Este arquivo é a tradução TypeScript do contrato aprovado no F1.0
 * (`docs/combat-engine-contract.md`): `CombatState`, `CombatAction`,
 * `CombatResult`, `CombatStateChange`, eventos e aleatoriedade.
 *
 * Regras deste módulo:
 *   • SÓ tipos — nenhuma função, nenhum estado, nenhuma regra.
 *   • Nada aqui executa rolagem, dano, cura, recarga, custo de ação ou
 *     iniciativa (isso é F1.5+, nunca o contrato).
 *   • Nenhuma dependência de React, Next.js, DOM, `localStorage`, Supabase ou
 *     `client-only`: tudo é `import type`, apagado em tempo de compilação.
 *   • Tipos já existentes são REUTILIZADOS (`AttackMode`, `AttackType`,
 *     `HitLocation`, `CriticalInjury`, `CriticalInjuryRoll`, `MesaEvent`,
 *     `MesaRollKind`, `ActionDenialReason`, `ActionEconomy`, `DiceResult`,
 *     `Stats`); o contrato não cria "segunda versão" de nada que já exista.
 *
 * Os ADAPTERS (`Character` → `CombatParticipant`,
 * `EncounterParticipant` → `CombatParticipant`) estão em `./adapters`.
 */
import type { CombatStatus, CombatantKind, MesaEvent } from "@/lib/mesa/types";
import type { MesaRollKind } from "@/lib/mesa/rollPolicy";
import type { ActionDenialReason, ActionEconomy } from "@/lib/combatEngine";
import type { AttackMode, AttackModifier, AttackType } from "@/types/attack";
import type { HitLocation } from "@/types/combat";
import type { ArmorRule } from "@/lib/combat/damage";
import type { AttributeName, Stats } from "@/types/character";
import type { CriticalInjury, CriticalInjuryRoll } from "@/data/criticalInjuries";
import type { DiceResult } from "@/lib/dice";

/** Identidade de um combatente DENTRO do engine. Obrigatória sempre. */
export type CombatantId = string;

/**
 * De onde vem o combatente — preserva as DUAS chaves que o F0.4/F0.5 separou:
 *
 *  • `characterId` — ficha de personagem (`mesa_combatants.character_id`).
 *  • `sourceKey`   — chave ESTÁVEL da INSTÂNCIA no encontro/mesmo template
 *                    (`mesa_combatants.source_key`; `null` em personagens).
 *  • `enemyId`     — TEMPLATE do bestiário (`enemyId`), que **nunca** é a
 *                    identidade da instância: `enemyId = template`,
 *                    `sourceKey = instance` (decisão F0.4/F0.5).
 */
export interface CombatSource {
  characterId: string | null;
  sourceKey: string | null;
  enemyId: string | null;
}

/**
 * Arma no contrato.
 *
 * `id` é opcional de propósito: a ficha tem `Weapon.id` (identidade usada pelo
 * reload, F0.6), mas o `EncounterParticipant` guarda a arma em campos planos
 * (`weaponName`/`damageExpression`/`weaponSkillId`) e **não tem id de arma** —
 * o adapter não inventa um.
 */
export interface CombatWeapon {
  id?: string;
  name: string;
  damage: string;
  skill?: string;
  attackType?: AttackType;
  rateOfFire?: number;
  magazine?: number;
  ammo?: number;
  catalogItemId?: string;
  /**
   * Base pronta de ATAQUE do encontro (F1.7 Gap 1) — `EncounterParticipant.
   * attackBase` (`weapon.attackBase ?? REF + nível`), que é exatamente o que
   * `combat/enemyAttacks.ts` soma hoje (`p.attackBase + 1d10 + bônus`).
   * Preservado como dado para que o futuro ataque reproduza a rolagem da tela
   * do Mestre sem regra nova. A ficha de personagem NÃO tem esse campo
   * (`Weapon` não o possui): ausente nela, e a base volta a ser
   * `stats[skill.stat] + nível`. Ausente = a origem não tem base pronta.
   */
  attackBase?: number;
  requiresTwoHands?: boolean;
}

/** Perícia reduzida ao que a regra usa: em qual STAT e qual o nível. */
export interface CombatSkill {
  stat: AttributeName;
  level: number;
}

/**
 * Peça de cyberware instalada, reduzida ao que as regras de efeitos LEEM
 * (`Pick<Character, "cyberware">` de `src/lib/cyberwareEffects.ts`).
 *
 * O F1.7 preserva o DADO de entrada (peças instaladas) e não um bônus pré-
 * calculado: `getCyberwareAttackModifiers` depende do CONTEXTO do ataque
 * (`ranged`/`smart`/`skillId`), que só existe quando a ação acontece — ver
 * §4 do relatório F1.7. Os modificadores continuam calculados UMA vez, na
 * regra canônica; nada é duplicado no adapter.
 *
 * Resolução é a de sempre: a ficha persiste `catalogItemId` (com fallback
 * por nome) e os implantes do inimigo são só nomes — mesmo caminho de
 * `resolveInstalledCyberwareItem`. Nome que não resolve em peça do catálogo
 * não gera efeito nenhum (sem bônus inventado).
 */
export interface CombatCyberwareItem {
  name: string;
  /** Referência ao catálogo: a ficha persiste, os implantes do inimigo não. */
  catalogItemId?: string;
  /** Estágio de ativação ligado; `0` = primeiro estágio (política do inimigo). */
  activeStage?: number;
}

/** Death Save da ficha (`CombatStats.deathSaveDC/deathSaveFailures`). */
export interface CombatDeathSave {
  dc: number;
  failures: number;
}

/** Estado de combate mutável do participante — tudo que uma ação pode mudar. */
export interface CombatHealth {
  hp: { current: number; max: number };
  armor: { head: number; body: number };
  /**
   * SP do cyberware instalado NO LOCAL, por `armorSlotForLocation` (F1.5).
   *
   * `armor` é só a veste; sem este campo a aplicação de dano do motor ignora
   * Subdermal Armor/Skin Weave e protege MENOS do que as três cadeias que já
   * existem (`damage.ts`, `enemyDamage.ts`, `cyberwareEffects.ts`). Só o corpo
   * tem SP de cyberware — `head` é sempre `0` (regra do F1.3) e os dois
   * adapters preenchem. Ausente = o contexto não modela implantes.
   */
  cyberwareSP?: { head: number; body: number };
  /**
   * Lesões da ficha. O encontro de inimigos **não** as modela
   * (`EncounterParticipant` não tem o campo) e o adapter devolve lista vazia —
   * não é "sem lesão": é "este contexto não rastreia".
   */
  criticalInjuries: CriticalInjury[];
  /** `{id,name}` no encontro/ficha; a MESA guarda `string[]` (F1.3 conecta). */
  conditions: Array<{ id: string; name: string }>;
  /** Ausente onde o contexto não tem death save (inimigo/encontro). */
  deathSave?: CombatDeathSave;
  /** `null` = ainda não rolou. A ordem NÃO é estado: use `sortByInitiative`. */
  initiative: number | null;
  isDead: boolean;
}

/**
 * Representação comum de `Character` e de `EncounterParticipant`.
 *
 * `stats`/`skills`/`economy` são opcionais porque nem todo contexto os tem:
 * a ficha tem os 10 STATs e a ficha de perícia inteira; o encontro tem só REF
 * (+MOVE quando existe) e, desde o F1.7, a PERÍCIA DA ARMA com o nível puro
 * recuperado do `skillValue` (fecha a pendência §6 do relatório F1.1) — não a
 * ficha de perícia completa, que o `EncounterParticipant` nunca teve.
 */
export interface CombatParticipant {
  id: CombatantId;
  type: CombatantKind;
  name: string;
  source: CombatSource;
  stats?: Partial<Stats>;
  skills?: Record<string, CombatSkill>;
  weapons?: CombatWeapon[];
  /**
   * Cyberware instalado no recorte mínimo das regras de efeitos (F1.7).
   * Ausente = a origem não tem peças — a ficha com lista vazia também fica
   * ausente, e um participante sem cyberware não recebe bônus nenhum.
   */
  cyberware?: CombatCyberwareItem[];
  combat: CombatHealth;
  /** Só a MESA tem orçamento de Actions/movimento (nunca inventado). */
  economy?: ActionEconomy;
}

/**
 * Estado completo de um combate.
 *
 * Sem `order` derivado (ordem = `sortByInitiative(participants)`), sem
 * relógios (`turnStartedAt` é carimbo de UI/servidor) e sem `eventLog`
 * (eventos saem do `CombatResult`, seção 9 do contrato).
 */
export interface CombatState {
  id: string;
  status: CombatStatus;
  round: number;
  initiativeStarted: boolean;
  activeParticipantId: CombatantId | null;
  participants: CombatParticipant[];
}

/* -------------------------------------------------------------------------- *
 * Ações — SÓ o nome da ação de domínio. O eixo de custo continua sendo
 * `CombatActionType`/`ACTION_COSTS`/`MESA_ROLL_ACTION`, que não muda.
 * -------------------------------------------------------------------------- */

/** Contexto defensivo do alvo — fornecido pelo caller ou resolvido pelo engine. */
export type DefenseContext =
  | {
      type: "dv";
      value: number;
      source: "range_table";
      reason?: string;
    }
  | {
      type: "evasion";
    };

/**
 * Ação de ATAQUE — F1.8C.
 *
 * `targetId` é obrigatório: todo ataque tem alvo.
 * `attackType` é obrigatório: o engine resolve a partir dele (ou de weaponId).
 * `attackMode` é "normal" | "aimed" | "autofire" | "suppressive" (F1.8D.7 —
 * os quatro modos do `AttackMode` do projeto; Autofire e Suppressive entram
 * pelo MESMO motor e mudam só o custo de munição, que é a única regra que o
 * projeto tem para cada um deles — ver `ammoConsumed`). NENHUMA mecânica
 * própria: sem `targets[]`, sem área, sem duração — isso é RULE GAP da etapa.
 * `defense` é sempre presente: DV (caller fornece) ou Evasion (engine resolve).
 */
export interface AttackAction {
  type: "attack";
  actorId: CombatantId;
  targetId: CombatantId;
  weaponId?: string;
  skillId?: string;
  attackType: AttackType;
  attackMode: "normal" | "aimed" | "autofire" | "suppressive";
  aimedTarget?: "head" | "leg" | "held_item";
  defense: DefenseContext;
  modifiers?: AttackModifier[];
  label?: string;
}

/** Resultado da resolução de um ataque individual. */
export interface AttackResult {
  attackId: string;
  attackType: AttackType;
  label: string;
  roll: DiceResult;
  baseStat: { id: AttributeName; value: number };
  skill: { id: string; value: number };
  total: number;
  /** Base pronta do snapshot de inimigo, quando a origem a declarou. */
  attackBase?: number;
  /** Modificadores efetivamente aplicados pelo engine, para auditoria. */
  modifiers?: AttackModifier[];
  critical: boolean;
  fumble: boolean;
  hit: boolean;
  defenseType: "dv" | "evasion";
  defenseValue: number;
  defenseRoll?: DiceResult;
  aimedTarget?: "head" | "leg" | "held_item";
  /**
   * Munição consumida por ESTE ataque (F1.8D.6/F1.8D.7): **1** nos modos
   * normal/aimed e **10** em Autofire E Supressive — a única regra que o
   * projeto tem para esses dois modos, cada uma com quatro fontes convergentes
   * (`lib/attacks.ts:297` `ammoCost`, o rótulo da UI "10 ammo", o contrato
   * F1.0 §13 nº 7 e o teste fechado `attack-mode-flow`).
   *
   * Consumida **incondicionalmente** após a resolução defensiva: miss e
   * fumble também pagam (mesmo comportamento do legado e do motor F1.8C).
   * Falha ANTES da rolagem (arma inexistente, munição menor que o custo) não
   * consome nada. Quantidade de tiros, área, dano por alvo, ROF mínimo e
   * duração da supressão: RULE GAP (F1.8D.7).
   */
  ammoConsumed: 1 | 10;
  weaponId?: string;
  /**
   * ROF da ARMA usada neste ataque (F1.8D.5) — resolvido por
   * `weaponId → actor.weapons → rateOfFire`. O contrato NÃO tem `action.rof`:
   * quem declara o valor é a arma, então o cliente não pode dizer que a arma
   * tem outro ROF que não o do cadastro.
   *
   * Ausente quando o ataque é por perícia (sem `weaponId`) ou quando a arma
   * não declara ROF — `monowire`, `frag_grenade` e `incendiary_grenade` do
   * catálogo não o têm, e o encontro achata a arma em escalares sem este
   * campo. Ausente ≠ erro.
   *
   * TRANSPORTE, sem mecânica: ROF 1 é exatamente o ataque de sempre e ROF > 1
   * **não** gera múltiplos ataques aqui (regra indefinida no projeto —
   * RULE GAP, §13 nº 8 do contrato F1.0: "ROF é informativo"). Não mexe em
   * munição (`ammoConsumed` segue 1), ações, defesa, dano nem lesão.
   */
  rateOfFire?: number;
  errors?: CombatError[];
}

export interface DamageAction {
  type: "damage";
  actorId: CombatantId | null;
  targetId: CombatantId;
  amount: number;
  hitLocation?: HitLocation;
  /** Atalho legado do caminho do encontro: `ignoreArmor ? "ignore" : "full"`. */
  ignoreArmor?: boolean;
  /**
   * Variante da regra de armadura (`full` | `martial_arts_half` | `ignore`).
   * Quando presente, manda (é o terceiro parâmetro de `applyDamage`); quando
   * ausente, vale o `ignoreArmor` acima. Sem isso a ação não consegue
   * expressar o `martial_arts_half` que a ficha usa em golpes de Artes
   * Marciais (`damage.applyAttackDamage`).
   */
  armorRule?: ArmorRule;
  /** Rolagem server-side usada para o gatilho de Critical Injury. */
  damageRolls?: number[];
}

/**
 * Resultado da resolução de UM dano (F1.8D.1) — o análogo do `AttackResult`
 * para a etapa seguinte do fluxo, que este módulo mantém separado de propósito:
 *
 *     AttackAction → Attack Engine → AttackResult (hit)
 *                                     ↓
 *                         DamageAction → Damage Engine → DamageResult
 *
 * Quem decide se o ataque acertou é o `AttackResult`; quem decide quanto
 * dano chega ao HP é o `DamageResult`. Um não faz o papel do outro.
 *
 * ## O que este tipo é (e o que não é)
 *
 * É um ESPELHO do que a regra canônica já decidiu, para o adapter/event
 * layer não recalcular regra nenhuma: o motor delega a cadeia completa
 * (SP efetivo → absorção → HP → derrota) para `applyDamage`
 * (`src/lib/combat/damage.ts`, F1.3) e devolve aqui os números daquela
 * decisão. Nenhuma fórmula é reescrita neste contrato.
 *
 *  · `hitLocation`      — a localização que ESTA resolução usou: o
 *                         `DamageAction.hitLocation` declarado pelo chamador
 *                         ou `body`, o default do motor desde F1.5 — o MESMO
 *                         valor que escolheu o slot de armadura e a tabela de
 *                         Critical Injury aqui dentro. Transporte puro
 *                         (F1.8D.3): não modifica dano, armadura nem lesão.
 *  · `rawDamage`        — o `DamageAction.amount` recebido, já rolado por
 *                         quem chamou (o motor NÃO rola dano nesta etapa).
 *  · `armorValue`       — o SP que abateu este dano (`DamageOutcome.
 *                         armorSPBefore`): com `full` é exatamente
 *                         `max(veste, cyberware)`; nas variantes de meia-SP
 *                         (`martial_arts_half`/`ignore`) é a meia-SP.
 *  · `damageAbsorbed`   — redução realmente aplicada (§5 "redução aplicada").
 *  · `damageAfterArmor` — quanto chegou ao HP (`DamageOutcome.damageToHP`,
 *                         já com `Math.max(0, ...)` contra dano negativo).
 *  · `hpBefore`/`hpAfter` — antes e depois, já com a POLÍTICA do alvo
 *                         (ficha aceita negativo; inimigo trava em 0).
 *  · `woundPenalty`     — calculado pela fonte única `getWoundPenalty`
 *                         (`@/lib/calculations`), sobre o HP resultante:
 *                         mesmo número que ataque, perícia e First Aid usam.
 *  · `criticalInjury`   — presente SÓ quando esta resolução GEROU uma lesão
 *                         (limiar de ferimento cruzado por um participante
 *                         que rastreia lesões): o par já existente
 *                         `CriticalInjuryRoll` — lesão E o 2d6 que a produziu
 *                         (F1.8D.4). Ausente = nenhuma lesão gerada.
 *  · `changes`          — o MESMO array de `CombatResult.changes` (mesma
 *                         referência, nunca divergente): HP, degradação da
 *                         veste, derrota e — quando aplicável — a lesão
 *                         crítica que o motor já rolava desde a F1.5.
 *
 * ## Por que não repete `errors`
 *
 * A validação do dano é tudo-ou-nada: quando algo é recusado nada foi
 * aplicado, o estado volta intacto e a recusa sai em `CombatResult.errors`
 * (o sistema de erro canônico, §13 — nenhum segundo sistema de erro). Um
 * `DamageResult` parcial, com metade dos campos por preencher, seria pior
 * para quem consome do que simplesmente não existir. Em outras palavras:
 * `damageResult` descreve um dano RESOLVIDO; `errors` descreve um dano
 * RECUSADO. Os dois nunca coexistem.
 */
export interface DamageResult {
  /** Correlação de evento, mesmo molde de `AttackResult.attackId` (carimbo, não regra). */
  damageId: string;
  /** `null` = dano de fonte externa/GM, como já modela `DamageAction.actorId`. */
  actorId: CombatantId | null;
  targetId: CombatantId;
  /**
   * Localização usada nesta resolução (`DamageAction.hitLocation`, `body` por
   * omissão) — a mesma que decidiu o slot de armadura e a tabela de lesões.
   * Transporte do F1.8D.3: informa ONDE o dano foi aplicado, sem regra nova.
   */
  hitLocation: HitLocation;
  /** Dano rolado/calculado ANTES da armadura — o motor não rola nada aqui. */
  rawDamage: number;
  /** SP que abateu este dano (com `full`: `max(veste, cyberware)`). */
  armorValue: number;
  /** Quanto a armadura segurou. */
  damageAbsorbed: number;
  /** Quanto chegou ao HP (nunca negativo). */
  damageAfterArmor: number;
  hpBefore: number;
  /** HP depois da política do alvo (ficha: pode ser negativo; inimigo: ≥ 0). */
  hpAfter: number;
  /** Fonte única: `getWoundPenalty` sobre o HP resultante (0, −2 ou 0 por Pain Editor). */
  woundPenalty: number;
  /**
    * Lesão crítica GERADA por este dano (F1.8D.4) — presente só quando o
    * participante rastreia lesões (`deathSave !== undefined`) E os dados de
    * dano contêm 2 ou mais resultados 6; ausente = nenhuma lesão.
   *
   * Reusa o tipo `CriticalInjuryRoll` (lesão + o 2d6 que a produziu) e devolve
   * a MESMA lesão de `critical_injury_added` em `changes` (idêntica por
   * referência) e os MESMOS valores do `rolls` de `kind: "critical_injury"` —
   * transporte explícito do resultado, não uma segunda lista. A localização é
   * o próprio `hitLocation` acima, a MESMA variável que escolheu a tabela.
   *
   * Crítico de ATAQUE (`AttackResult.critical`, dado natural 10) não tem nada
   * a ver com isto: ataque crítico não gera lesão por si só.
   */
  criticalInjury?: CriticalInjuryRoll;
  specialCriticalInjury?: CriticalInjury;
  /** Mesma referência de `CombatResult.changes`. */
  changes: CombatStateChange[];
}

/**
 * Ação de EVASÃO standalone — resolvida pelo motor desde o F1.8D.9.
 *
 * É a rolagem de perícia POR SI SÓ, fora de um ataque, e permanece
 * conceitualmente SEPARADA de `AttackAction`: um ataque com
 * `defense: {type:"evasion"}` resolve a defesa dentro de `executeAttack`
 * (F1.8C); esta ação rola a Evasão quando nenhum ataque está em curso.
 * Gastar uma `EvasionAction` ao defender seria integração de Action Economy —
 * RULE GAP do F1.8D.9, não implementada.
 *
 * `modifiers` = modificadores temporários que o chamador declara — o mesmo
 * papel do parâmetro `modifiers` de `rollEvasion` da ficha. `targetId` é
 * pré-existente (F1.1) e NÃO tem semântica mecânica determinada: a
 * resolução o ignora (registrado como dívida na etapa).
 *
 * A resolução não muda estado, não gera evento e **não debita ações** — o
 * custo da Evasão na mesa (`MESA_ROLL_ACTION.evasion = "other"` = 1) é da
 * camada Mesa/`resolveAction`; o motor ainda não tem Action Economy.
 */
export interface EvasionAction {
  type: "evasion";
  actorId: CombatantId;
  targetId?: CombatantId;
  modifiers?: AttackModifier[];
}

/**
 * Resultado de uma `EvasionAction` RESOLVIDA (F1.8D.9) — espelho da
 * estrutura de `AttackResult` (roll/baseStat/skill/total/critical/fumble).
 *
 * Fórmula = a DETERMINADA da ficha (`rollEvasion`, `attacks.ts:317-377`),
 * montada com os mesmos helpers canônicos:
 *
 *   STAT(skill.stat) + nível + 1d10 + `action.modifiers`
 *   + penalidade de lesão (`getWoundPenalty`, fonte única; Pain Editor zera)
 *   + cyberware de Evasão (Kerenzikov/Sandevistan…) + cyberware "todo físico"
 *   + lesão crítica (allPhysical + allActions + STAT da perícia)
 *
 * Dados: a MESMA regra do ataque (F1.8C — primeiro 10 soma um dado, primeiro
 * 1 subtrai, sem cadeia), idêntica à da ficha. Sem modificadores expostos
 * (mesma decisão do `AttackResult`: o total é o contrato) e sem id — a ação
 * não persiste nada. `critical`/`fumble` = primeiro dado natural 10/1.
 */
export interface EvasionResult {
  /** Dados rolados — `expression` "1d10" (ou "2d10" quando sai o dado extra). */
  roll: DiceResult;
  /** STAT base da perícia (`skill.stat` — DEX na ficha). */
  baseStat: { id: AttributeName; value: number };
  /** Perícia resolvida de `actor.skills.evasion` — ausente = recusa, nunca 0. */
  skill: { id: string; value: number };
  /** STAT + nível + dados + modificadores. */
  total: number;
  /** Primeiro dado natural 10 (mesma leitura de critical do ataque). */
  critical: boolean;
  /** Primeiro dado natural 1 (idem fumble). */
  fumble: boolean;
}

export interface SkillCheckAction {
  type: "skill_check";
  actorId: CombatantId;
  skillId: string;
  modifiers?: AttackModifier[];
  actionContext?: SkillCheckActionContext;
}

export type SkillCheckActionContext = "free" | "action" | "reaction";

export interface MoveAction {
  type: "move";
  actorId: CombatantId;
  meters: number;
}

export interface ReloadAction {
  type: "reload";
  actorId: CombatantId;
  /** Ausente no encontro: o inimigo tem UMA arma e ela não tem id. */
  weaponId?: string;
}

export interface HealAction {
  type: "heal";
  actorId: CombatantId;
  targetId?: CombatantId;
  /** Item da mochila (`applyHealingItem`/`applyParticipantHealingItem`). */
  item?: string;
}

export interface DeathSaveAction {
  type: "death_save";
  actorId: CombatantId;
}

export interface InitiativeAction {
  type: "initiative";
  actorId: CombatantId | null;
  /** Sem `targetIds` = todo mundo (`store.rollInitiativeForAll`). */
  targetIds?: CombatantId[];
}

export interface ConditionAction {
  type: "condition";
  actorId: CombatantId | null;
  targetId: CombatantId;
  op: "add" | "remove";
  condition: { id: string; name: string };
}

/** Combate só existe enquanto a mesa/o encontro dizem que existe. */
export interface LifecycleAction {
  type: "start_combat" | "end_combat" | "end_turn";
  actorId: CombatantId | null;
}

export interface OtherAction {
  type: "other";
  actorId: CombatantId | null;
  label?: string;
}

export type CombatAction =
  | AttackAction
  | DamageAction
  | EvasionAction
  | SkillCheckAction
  | MoveAction
  | ReloadAction
  | HealAction
  | DeathSaveAction
  | InitiativeAction
  | ConditionAction
  | LifecycleAction
  | OtherAction;

/* -------------------------------------------------------------------------- *
 * Resultado
 * -------------------------------------------------------------------------- */

/** O que uma ação pode produzir de rolagem — reutiliza `MesaRollKind`. */
export type CombatRollKind = MesaRollKind | "initiative" | "death_save" | "critical_injury";

/** Uma rolagem gerada pela ação. `DiceResult` = `{expression,rolls,total}`. */
export interface CombatRoll extends DiceResult {
  kind: CombatRollKind;
  actorId: CombatantId | null;
  targetId?: CombatantId;
}

/**
 * Nomeada + `before`/`after`: é o que o cliente espelha sem receber o estado
 * inteiro a cada evento (HP, munição, condições, virada de turno).
 */
export type CombatStateChange =
  | { type: "hp_changed"; participantId: CombatantId; before: number; after: number }
  | { type: "is_dead_changed"; participantId: CombatantId; before: boolean; after: boolean }
  /**
   * SP da VESTE do local que se degradou com o golpe. Só a veste perde SP
   * (pendência do F1.3 mantida) — o SP de cyberware em `cyberwareSP` não se
   * degrada. Sem esta entrada o cliente só descobriria a degradação
   * comparando o estado inteiro (seção 10 do contrato).
   */
  | { type: "armor_changed"; participantId: CombatantId; location: "head" | "body"; before: number; after: number }
  | {
      type: "ammo_changed";
      participantId: CombatantId;
      weaponId: string | null;
      before: number;
      after: number;
    }
  | {
      type: "initiative_changed";
      participantId: CombatantId;
      before: number | null;
      after: number | null;
    }
  | {
      type: "economy_changed";
      participantId: CombatantId;
      before: ActionEconomy;
      after: ActionEconomy;
    }
  | {
      type: "death_save_changed";
      participantId: CombatantId;
      before: CombatDeathSave;
      after: CombatDeathSave;
    }
  | {
      type: "conditions_changed";
      participantId: CombatantId;
      before: string[];
      after: string[];
    }
  | { type: "critical_injury_added"; participantId: CombatantId; injury: CriticalInjury }
  | { type: "turn_changed"; activeParticipantId: CombatantId | null; round: number }
  | { type: "combat_status_changed"; status: CombatStatus };

/**
 * Evento do combate: é o `MesaEvent` SEM o carimbo de tempo — `at` é colado
 * pelo store em `store.appendEvent`, o único ponto que grava no event log
 * (F0.1). O F1.6 liga isto ao log pelo adapter `src/lib/mesa/combatEvents.ts`,
 * que fica FORA do núcleo de combate.
 */
export type CombatEvent = Omit<MesaEvent, "at">;

/** Motivo de recusa: o mesmo vocabulário que o cliente já entende. */
export type CombatErrorCode =
  | ActionDenialReason
  | "invalid_state"
  | "unknown_participant"
  | "rule_violation";

export interface CombatError {
  code: CombatErrorCode;
  message: string;
}

/**
 * Resultado de `engine.execute(state, action, rng)` (F1.5).
 * `state` é o estado DEPOIS da ação; `changes`/`rolls`/`events` explicam o que
 * aconteceu, para o cliente espelhar e o servidor persistir.
 */
export interface CombatResult {
  ok: boolean;
  state: CombatState;
  changes: CombatStateChange[];
  rolls: CombatRoll[];
  events: CombatEvent[];
  errors?: CombatError[];
  attackResult?: AttackResult;
  /** Presente só quando uma `DamageAction` foi RESOLVIDA (F1.8D.1); na recusa vêm `errors`. */
  damageResult?: DamageResult;
  /**
   * Presente só quando uma `EvasionAction` foi RESOLVIDA (F1.8D.9); na
   * recusa vêm `errors`. A recusa NUNCA coexiste com o resultado.
   */
  evasionResult?: EvasionResult;
}

/* -------------------------------------------------------------------------- *
 * Aleatoriedade (F1.4 injeta; F1.1 só define o formato)
 * -------------------------------------------------------------------------- */

/**
 * Fonte de sorteio injetável — último parâmetro opcional das funções que
 * sorteiam. Sem ela o default continua sendo `rollDice` (`Math.random`, hoje
 * fixo em `src/lib/dice.ts:9`), mesmo molde de `getEnemySupplies(rng)`.
 * Deixa o motor testável sem mockar `Math.random`.
 */
export interface RandomSource {
  roll(expression: string): DiceResult;
  d10(): number;
}
