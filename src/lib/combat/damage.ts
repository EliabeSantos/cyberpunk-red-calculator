/**
 * F1.3 — REGRA CANÔNICA de APLICAÇÃO de dano.
 *
 * Antes desta etapa a mesma matemática estava escrita três vezes:
 *
 *   · `applyReceivedDamage`    (ficha, dano manual)   → `src/lib/damage.ts`
 *   · `applyAttackDamage`      (ficha, ataque rolado) → `src/lib/damage.ts`
 *   · `applyDamageToParticipant` (inimigo, encontro)  → `src/lib/combat/enemyDamage.ts`
 *
 * Todas resolviam a MESMA cadeia: SP efetivo do local → o que a armadura
 * absorve → quanto chega ao HP → degradação da veste → novo HP. Aqui isso é
 * uma função só; as três viraram adaptadoras que mantêm a própria assinatura
 * e as próprias camadas (histórico, Critical Injury, Death Save, persistência).
 *
 * ## ROLL × APPLICATION
 *
 * Esta função **não rola nada**: `damage` chega pronto (número já calculado),
 * como no contrato do F1.1. Rolagem continua em `rollDamage`/`rollDice`, e as
 * regras que dependem de dado (Critical Injury por dois 6, Wound Threshold,
 * Death Save) continuam em `src/lib/damage.ts` — camada da ficha, não da
 * aplicação. Isso mantém o módulo determinístico e fora do F1.4 (RandomSource).
 *
 * ## POLÍTICA EXPLÍCITA (as divergências REAIS, não hipóteses)
 *
 *   player (ficha)          → HP pode ficar negativo (o Death Save decide a
 *                             morte); a derrota NÃO vem do dano (`isDead` só
 *                             muda em `rollDeathSave`/First Aid).
 *   enemy (inimigo)         → HP trava em 0; `hp ≤ 0` É a derrota (é a regra
 *                             que a mesa espelha como `is_dead`).
 *
 * E duas variantes de SP, também reais e também diferentes entre si:
 *
 *   "martial_arts_half" (ficha) → SP/2 arredondado PARA CIMA (11 → 6) e a
 *                                 degradação avalia o SP já cortado.
 *   "ignore" (inimigo)          → SP/2 arredondado PARA BAIXO (11 → 5) e a
 *                                 degradação continua avaliando o SP CHEIO.
 *
 * São as duas implementações de hoje (F1.0 §13: `ignoreArmor` ≠ Artes
 * Marciais). **Nenhuma delas foi corrigida aqui** — mudar arredondamento ou
 * degradação é assunto de etapa própria.
 *
 * ## Pendência (F1.3 / backlog)
 *
 * Verificar se a fonte de SP usada na degradação deve ser a proteção que
 * **efetivamente** absorveu o dano: hoje quem perde 1 SP é sempre a *veste*
 * (`wornArmorSP`), mesmo quando quem protegeu foi o SP de cyberware (a
 * subdérmica não degrada e a veste de 4 cai para 3). Preservado de propósito.
 *
 * Pura: zero imports — nada de React, Next, DOM, `localStorage`, Supabase,
 * `gmStorage` ou `client-only` — e nunca muta o `target` recebido.
 */

/** O que a regra precisa ler do alvo — um recorte, nunca a ficha/participante inteiro. */
export interface DamageTarget {
  /** HP antes do dano. */
  hp: number;
  /** SP da armadura **vestida** no local atingido (`character.combat.armor` / `participant.armor`). */
  wornArmorSP: number;
  /**
   * SP de cyberware aplicável ao local (corpo apenas — cabeça nunca tem).
   * É constante: não degrada com penetração, só a veste perde SP.
   */
  cyberwareSP: number;
  /** `isDead` atual. Só a política `player` o preserva; a `enemy` ignora. */
  isDead?: boolean;
}

/**
 * Como o SP é tratado **neste ataque** — as variantas que existem no código.
 * O padrão (sem redução) é `"full"`.
 */
export type ArmorRule =
  /** Dano − SP cheio; degrada quando o dano passa do SP. */
  | "full"
  /** Artes Marciais (ficha): dano − ceil(SP/2); degrada acima desse SP cortado. */
  | "martial_arts_half"
  /** `ignoreArmor` (inimigo): dano − floor(SP/2); degrada acima do SP **cheio**. */
  | "ignore";

/**
 * Declara as diferenças de comportamento entre os dois participantes.
 * Campos booleanos de propósito: a política é um dado declarado, não um `if`
 * espalhado pela regra.
 */
export interface DamagePolicy {
  kind: "player" | "enemy";
  /** `true` = o HP pode descer abaixo de 0 (ficha); `false` = trava em 0 (inimigo). */
  allowNegativeHp: boolean;
  /** `true` = a derrota sai do HP resultante (inimigo); `false` = `isDead` não muda com dano. */
  defeatFromHp: boolean;
}

/** Ficha do jogador: Death Save é quem decide morte, não o clamp de HP. */
export const PLAYER_DAMAGE_POLICY: DamagePolicy = {
  kind: "player",
  allowNegativeHp: true,
  defeatFromHp: false,
};

/** Inimigo do encontro: 0 HP = fora da ordem de turno (mesma regra da mesa). */
export const ENEMY_DAMAGE_POLICY: DamagePolicy = {
  kind: "enemy",
  allowNegativeHp: false,
  defeatFromHp: true,
};

/** Resultado completo da aplicação — o que os adaptadores precisam repassar. */
export interface DamageOutcome {
  /** Dano bruto informado (nada foi rolado aqui). */
  damage: number;
  /** SP efetivamente abatido nesta aplicação (pode ser meia-SP). Vira `DamageApplicationResult.armorSPBefore`. */
  armorSPBefore: number;
  /** Quanto a armadura segurou. */
  damageAbsorbed: number;
  /** Quanto chegou ao HP. */
  damageToHP: number;
  hpBefore: number;
  /** HP depois da política (`allowNegativeHp`). */
  hpAfter: number;
  /** SP da **veste** depois da degradação — é o valor que as fichas gravam. */
  wornArmorSPAfter: number;
  /** SP efetivo depois da degradação (veste × cyberware) — vira `armorSPAfter`. */
  armorSPAfter: number;
  /** `true` quando a Artes Marciais cortou o SP (só a ficha usa). */
  spHalvedByMartialArts: boolean;
  isDeadBefore: boolean;
  /** Derrota calculada pela política (inimigo: `hp ≤ 0`; ficha: inalterada). */
  isDeadAfter: boolean;
}

/**
 * SP efetivo de um local: armadura vestida e cyberware **não acumulam** —
 * vale o maior. É o mesmo predicado de sempre (`getEffectiveArmorSP` da ficha
 * e `getParticipantArmorSP` do inimigo), agora numa fonte só.
 */
export function effectiveArmorSP(wornArmorSP: number, cyberwareSP: number): number {
  return Math.max(wornArmorSP, cyberwareSP);
}

/**
 * Derrota segundo a política: inimigo morre em 0 HP; a ficha mantém o valor
 * atual (0 HP é só "Mortally Wounded", o Death Save é quem mata).
 * Reutilizada pelo espelho de HP da mesa (`syncCombatHp`).
 */
export function isDefeatedBy(policy: DamagePolicy, hp: number, isDeadBefore: boolean): boolean {
  return policy.defeatFromHp ? hp <= 0 : isDeadBefore;
}

/**
 * O HP atravessou o limiar de Seriously Wounded? — `hpBefore` acima e
 * `hpAfter` embaixo do `threshold`, que quem chama calcula com
 * `calculateWoundThreshold(maxHp)` (daí o parâmetro: o módulo continua sem
 * imports e sem rolagem).
 *
 * F1.5: é o predicado que a ficha repetia em `applyReceivedDamage` e
 * `applyAttackDamage`; agora ficha e motor perguntam à mesma fonte.
 */
export function woundThresholdCrossed(hpBefore: number, hpAfter: number, threshold: number): boolean {
  return hpBefore > threshold && hpAfter <= threshold;
}

/**
 * Aplica um dano **já rolado** a um alvo, sem mutá-lo.
 *
 * Devolve a transformação pura (HP, SP da veste, degradação e derrota); montar
 * ficha, histórico, Critical Injury ou persistir é responsabilidade de quem
 * chama.
 */
export function applyDamage(
  target: DamageTarget,
  damage: number,
  policy: DamagePolicy,
  armorRule: ArmorRule = "full",
  postArmorMultiplier = 1,
): DamageOutcome {
  const wornArmorSP = target.wornArmorSP;
  const cyberwareSP = target.cyberwareSP;
  const effectiveSP = effectiveArmorSP(wornArmorSP, cyberwareSP);

  const spUsed =
    armorRule === "martial_arts_half"
      ? Math.ceil(effectiveSP / 2)
      : armorRule === "ignore"
        ? Math.floor(effectiveSP / 2)
        : effectiveSP;

  const damageToHP = Math.max(0, damage - spUsed) * postArmorMultiplier;
  const damageAbsorbed = Math.min(damage, spUsed);

  const hpBefore = target.hp;
  const hpAfter = policy.allowNegativeHp ? hpBefore - damageToHP : Math.max(0, hpBefore - damageToHP);

  // Degradação: a veste perde 1 SP quando o dano passou da proteção. Ver o
  // cabeçalho: a ficha avalia o SP que abateu (inclusive meia-SP) e o inimigo
  // (`ignore`) avalia o SP cheio — comportamento atual, preservado.
  const spForDegradation = armorRule === "ignore" ? effectiveSP : spUsed;
  const wornArmorSPAfter =
    damage > spForDegradation ? Math.max(0, wornArmorSP - 1) : wornArmorSP;

  const isDeadBefore = target.isDead ?? false;

  return {
    damage,
    armorSPBefore: spUsed,
    damageAbsorbed,
    damageToHP,
    hpBefore,
    hpAfter,
    wornArmorSPAfter,
    armorSPAfter: effectiveArmorSP(wornArmorSPAfter, cyberwareSP),
    spHalvedByMartialArts: armorRule === "martial_arts_half" && effectiveSP > 0,
    isDeadBefore,
    isDeadAfter: isDefeatedBy(policy, hpAfter, isDeadBefore),
  };
}
