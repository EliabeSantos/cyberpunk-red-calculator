/**
 * F1.8D.3 — HIT LOCATION RESOLVER: "onde o ataque acertou?".
 *
 * Responsabilidade nova do fluxo — a quarta, ao lado das outras três (§19 do
 * plano F1.8D.3):
 *
 *     Attack Engine   → acertou ou errou?          (F1.8C)
 *     Weapon Damage   → quanto a arma rolou?       (F1.8D.2)
 *     este módulo     → ONDE o ataque acertou?     (só com hit === true)
 *     Damage Engine   → quanto atravessa a armadura (F1.8D.1)
 *
 * O que este módulo **não** faz (fronteiras explícitas):
 *
 *  · não aplica dano, Armor ou Critical Injury; essas regras continuam no
 *    Damage Engine;
 *  · não resolve Critical Injury: `HitLocation ≠ Critical Injury`; quem lê a
 *    tabela continua sendo o Damage Engine (`rollCriticalInjuryDetail`,
 *    engine.ts:189 — inalterado);
 *  · não conhece o −8 do Aimed Shot: o modificador é do Attack Engine e este
 *    módulo só LÊ o que o ataque decidiu (F1.8C intacto);
 *  · não rola nada: localização normal é deterministicamente `body`.
 *
 * ## FONTES (auditadas — nenhuma delas inventada aqui)
 *
 *   tipo canônico → `HitLocation` de `src/types/combat.ts`
 *                   (`head | body | leg | held_item`), o MESMO tipo de
 *                   `DamageAction.hitLocation`,
 *                   do `RollHistoryEntry` da ficha, das opções do `<select>`
 *                   e das chaves de `criticalInjuryTables`. Nenhum enum
 *                   paralelo, nenhuma string nova (§3 do plano).
 *   entrada       → `AttackResult.aimedTarget` do F1.8C
 *                   (`"head" | "body" | "leg" | "held_item"`), copiado do
 *                   `AttackAction` pelo próprio motor (engine.ts:711).
 *
 * Ataque normal → `body`; ataques aimed aceitam somente `head`, `leg` e
 * `held_item`. A localização é sempre determinada sem aleatoriedade.
 *
 * Módulo puro: sem DOM, `localStorage`, Supabase, `gmStorage`, React,
 * `client-only`, `Math.random()` e sem `RandomSource` (passa pela rede de
 * `combat-purity`).
 */
import type { AttackResult, CombatError } from "@/lib/combat/contract";
import type { HitLocation } from "@/types/combat";

/**
 * Resultado do resolver — ou o motivo de não haver localização.
 *
 * Espelha `WeaponDamageRollResult` (F1.8D.2) de propósito: mesma forma, mesmo
 * sistema de erro (`CombatError`, §17 do plano — nenhum segundo sistema), e
 * ele NÃO duplica `DamageResult`, que descreve o dano já aplicado:
 *
 *     HitLocationResult → onde o ataque acertou (ou por que não se sabe)
 *     DamageResult      → o que aconteceu depois de aplicar no alvo
 */
export type HitLocationResult =
  | { ok: true; location: HitLocation }
  | { ok: false; error: CombatError };

/** Os alvos que o `AttackAction`/`AttackResult` do F1.8C sabe expressar. */
type AimedTarget = NonNullable<AttackResult["aimedTarget"]>;

/**
 * O que cada alvo do contrato produz em `HitLocation`.
 *
 * O tipo `Record<AimedTarget, …>` é proposital: se o F1.8C ganhar um alvo
 * novo, o `tsc` para aqui até alguém declarar, conscientemente, ou a
 * localização correspondente ou o `gap` — a lacuna não pode aparecer sem ser
 * documentada (§22).
 *
 *  · `{ location }` → dá para transportar sem regra nova;
 *  · `{ gap }`       → o contrato atual não sabe representar → recusa.
 */
const AIMED_TARGET: Record<AimedTarget, { location: HitLocation }> = {
  head: { location: "head" },
  leg: { location: "leg" },
  held_item: { location: "held_item" },
};

/** Recusa estruturada: nenhuma localização é inventada (§16/§22). */
function recusa(message: string): HitLocationResult {
  return { ok: false, error: { code: "rule_violation", message } };
}

/**
 * Determina ONDE `attack` acertou, se acertou.
 *
 * Ordem das checagens — a primeira recusa vence:
 *
 *   1. `attack.hit === false` → miss não tem localização de impacto: nunca
 *      se sorteia nem se deduz localização para um erro (§16);
 *   2. sem `aimedTarget` (ataque normal) → `body`;
 *   3. `head`/`leg`/`held_item` → a localização determinada, sem RNG.
 *
 * Devolve `CombatError` nas recusas (§17 do plano — o sistema do contrato).
 */
export function resolveHitLocation(attack: AttackResult): HitLocationResult {
  if (!attack.hit) {
    return recusa(`Ataque "${attack.label}" não acertou: não há localização de impacto.`);
  }

  const target = attack.aimedTarget;
  if (target === undefined) {
    return { ok: true, location: "body" };
  }

  const outcome = AIMED_TARGET[target];
  if (!outcome) {
    // Dado de runtime fora do contrato F1.8C (o motor não valida o VALOR do
    // `aimedTarget`, só a presença): recusa em vez de devolver lixo.
    return recusa(`Ataque "${attack.label}" mirou "${String(target)}", que não é um alvo do contrato.`);
  }

  if ("location" in outcome) {
    return { ok: true, location: outcome.location };
  }

  return recusa(`Ataque "${attack.label}" mirou "${target}", que não é um alvo aimed suportado.`);
}
