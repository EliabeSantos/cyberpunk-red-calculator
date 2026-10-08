/**
 * F1.8D.2 — WEAPON DAMAGE RESOLVER: "quanto a arma rolou?".
 *
 * Terceira responsabilidade do fluxo de combate, separada das outras duas de
 * propósito (§19 do plano F1.8D.2):
 *
 *     Attack Engine   → acertou ou errou?
 *     este módulo     → quanto a arma rolou?          (ataque.hit === true)
 *     Damage Engine   → quanto atravessa a armadura?  (applyDamage, F1.3)
 *
 * O resolver **não toca em armadura, HP ou `applyDamage`** e não decide nada
 * sobre o ataque além de conferir o que o `AttackResult` já decidiu. Ele lê a
 * definição canônica da arma, rola os dados pela fonte injetável e devolve o
 * dano BRUTO, que o chamador coloca em `DamageAction.amount` — a fronteira
 * entre "dano rolado" e "dano resolvido" continua sendo o `DamageAction`
 * (F1.1/F1.8D.1), que não mudou.
 *
 * ## FONTES (auditadas, não inventadas)
 *
 *   formato do dano   → `CombatWeapon.damage: string` no formato `NdM`
 *                       (`"3d6"`, `"2d6"`, `"1d10"`). É o MESMO campo que a
 *                       ficha usa (`Weapon.damage`, `types/character.ts`) e o
 *                       que o adapter do encontro copia de
 *                       `EncounterParticipant.damageExpression`
 *                       (`combat/adapters.ts`) — uma só representação no motor.
 *   rolagem           → `rollDice(expression, rng)` de `src/lib/dice.ts`, o
 *                       parser canônico `NdM` (validação, normalização e soma
 *                       são dele; a fonte é o `RandomSource` do F1.1). É o
 *                       MESMO chamador das camadas de ficha
 *                       (`src/lib/damage.ts:rollDamage`) e de encontro
 *                       (`combat/enemyDamage.ts:rollDamage`).
 *
 * Nenhuma tabela de armas nova, nenhum parser novo, nenhum RNG novo.
 *
 * ## DIVERGÊNCIA CONHECIDA (preservada, §4 do plano)
 *
 * `src/lib/enemyRolls.ts:rollDamageExpression` tem um parser LOCAL de termos
 * `+` (`1d6+3`, `1d6+1d6`) e **não injeta RandomSource** (cai no
 * `browserRandom`). Ele serve ao botão "Rolar Dano" da tela de inimigos, fica
 * fora da rede de pureza do F1.2 e não é usado pelo motor — não foi migrado
 * nem copiado aqui. Do mesmo jeito, `getParticipantDamageExpression` monta
 * `1d6+1d6` só como RÓTULO (bônus de implante no desarmado) e o encontro rola
 * esse bônus como rolagem separada.
 *
 * Consequência prática e honesta: uma expressão com `+` vinda de `weapon.
 * damage` é recusada por este resolver, porque o parser canônico só aceita
 * `NdM` — nenhuma arma dos dados reais tem `+` (auditado: só `NdM`).
 * Aceitar `+` exigiria um segundo parser, que esta etapa não cria.
 *
 * ## Limitação de identidade (§12 do plano)
 *
 * A procura é por `AttackResult.weaponId` → `actor.weapons.find(w => w.id)`,
 * o MESMO mecanismo do Attack Engine. Só a ficha tem `Weapon.id`; o encontro
 * guarda a arma em campos planos e **não tem id de arma** — decisão
 * documentada no próprio contrato (F1.1: "o adapter não inventa um"). Um
 * ataque de encontro (que vai pelo caminho `skillId`) chega aqui sem
 * `weaponId` e é recusado com erro claro; resolver isso exigiria escolher uma
 * nova identidade de arma, o que é decisão de etapa própria, não silêncio
 * desta.
 *
 * ## Fronteiras
 *
 *  • só rola quando `AttackResult.hit === true` — um erro não consome
 *    `RandomSource` nenhum (o miss não gasta dado de dano);
 *  • não cria `DamageAction` nem `DamageResult`: o chamador monta a ação com
 *    `amount: roll.total` e o Damage Engine (F1.8D.1) continua o dono de
 *    armadura/HP/penalidade;
 *  • não faz rolagem de Local de Impacto, não aplica Critical Injury nem
 *    dano crítico (todos DEFERRED, §6/§7 do plano);
 *  • erros saem em `CombatError` — o sistema de erro do contrato (§11).
 *
 * Módulo puro: sem DOM, `localStorage`, Supabase, `gmStorage`, React,
 * `client-only` nem `Math.random()` (passa pela rede de `combat-purity`).
 */
import { browserRandom, rollDice, rollDiceWith } from "@/lib/dice";
import { getUnarmedDamageDice } from "@/lib/attacks";
import { getCyberwareUnarmedDamageModifiers, hasInstalledCyberarm } from "@/lib/cyberwareEffects";
import type { DiceResult } from "@/lib/dice";
import type {
  AttackResult,
  CombatError,
  CombatParticipant,
  RandomSource,
} from "@/lib/combat/contract";

/**
 * Resultado da rolagem de dano de uma arma — ou o motivo de não ter havido
 * rolagem.
 *
 * O caso de sucesso é o **próprio `DiceResult`** (`{expression, rolls, total}`),
 * o tipo canônico de "o que foi rolado": ele já carrega a expressão usada,
 * cada dado e o total que vira `DamageAction.amount`. Nada aqui duplica
 * `DamageResult` (que descreve o dano JÁ aplicado) nem cria um segundo tipo
 * de rolagem — a distinção é:
 *
 *     WeaponDamageRollResult → o que a arma rolou (ou por que não rolou)
 *     DamageResult           → o que aconteceu depois de aplicar no alvo
 */
export type WeaponDamageRollResult =
  | { ok: true; roll: DiceResult }
  | { ok: false; error: CombatError };

/** Recusa estruturada: nada foi rolado, nenhuma fonte foi consumida. */
function recusa(message: string): WeaponDamageRollResult {
  return { ok: false, error: { code: "rule_violation", message } };
}

/**
 * Rola o dano da arma que gerou `attack`, se o ataque acertou.
 *
 * Ordem das checagens — a primeira recusa vence e nenhuma delas toca no
 * `rng`:
 *
 *   1. `attack.hit`      → miss não tem dano a rolar (§3/§13);
 *   2. `attack.weaponId` → sem arma identificada não há definição de dano;
 *   3. arma em `actor.weapons` (o mesmo `find` do Attack Engine);
 *   4. `weapon.damage` preenchido;
 *   5. expressão válida no parser canônico (`NdM`);
 *   6. rolagem real pela fonte injetada.
 *
 * A validação (5) roda "a seco" pelo MESMO `rollDiceWith` canônico, com um
 * sorteador descartável: assim uma definição inválida é recusada **sem
 * consumir** a sequência, enquanto um erro da própria fonte (RNG esgotado,
 * valor fora do intervalo) NÃO é engolido como se fosse regra — ele se
 * propaga, porque é erro de quem escreveu o teste, não do dado da arma.
 *
 * `rng` é opcional com `browserRandom`, como em `rollDice` e `execute`.
 */
export function rollWeaponDamage(
  actor: CombatParticipant,
  attack: AttackResult,
  rng: RandomSource = browserRandom,
): WeaponDamageRollResult {
  if (!attack.hit) {
    return recusa(`Ataque "${attack.label}" não acertou: não há dano a rolar.`);
  }

  if (!attack.weaponId) {
    // Brawling/Martial Arts/Weaponless já possuem a definição canônica de
    // dano na ficha (`getUnarmedDamageDice`). O ataque continua atravessando
    // este mesmo resolver de dano; apenas não há stableItemId para procurar.
    if (attack.attackType !== "brawling" && attack.attackType !== "martial_arts" && attack.attackType !== "unarmed") {
      return recusa(
        `Ataque "${attack.label}" sem weaponId: o dano só é resolvido para armas identificadas.`,
      );
    }
    const body = actor.stats?.BODY;
    if (typeof body !== "number") return recusa(`Ataque "${attack.label}" sem BODY server-side.`);
    const cyberware = (actor.cyberware ?? []).map((item) => ({
      id: item.catalogItemId ?? item.name,
      name: item.name,
      installedAt: "",
      ...(item.catalogItemId ? { catalogItemId: item.catalogItemId } : {}),
      ...(item.activeStage !== undefined ? { activeStage: item.activeStage } : {}),
    }));
    const bonus = getCyberwareUnarmedDamageModifiers({ cyberware }).reduce((sum, modifier) => sum + modifier.value, 0);
    const expression = getUnarmedDamageDice(body, bonus, hasInstalledCyberarm({ cyberware }));
    try {
      rollDiceWith(expression, () => 1);
    } catch {
      return recusa(`Expressão de dano inválida: ${expression}`);
    }
    return { ok: true, roll: rollDice(expression, rng) };
  }

  const weapon = actor.weapons?.find((candidate) => candidate.id === attack.weaponId);
  if (!weapon) {
    return recusa(`Arma "${attack.weaponId}" não existe em ${actor.name}.`);
  }

  const expression = typeof weapon.damage === "string" ? weapon.damage.trim() : "";
  if (expression.length === 0) {
    return recusa(`Arma "${weapon.name}" não possui definição de dano.`);
  }

  // Validação canônica a seco: mesmo parser, sorteio descartável — nenhum
  // valor da fonte real é consumido quando a definição está errada.
  try {
    rollDiceWith(expression, () => 1);
  } catch {
    return recusa(`Expressão de dano inválida: ${expression}`);
  }

  // Daqui em diante a expressão é válida: um throw aqui é da FONTE
  // (RandomSource esgotado/fora do intervalo) e deve chegar ao chamador.
  return { ok: true, roll: rollDice(expression, rng) };
}
