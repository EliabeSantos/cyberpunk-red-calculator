import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyCharacter } from "../src/types/character.ts";
import {
  getAvailableAttacks,
  getUnarmedDamageDice,
  rollAttack,
} from "../src/lib/attacks.ts";
import {
  applyAttackDamage,
  rollDamage,
  rollDamageForLastAttack,
} from "../src/lib/damage.ts";
import { installCyberware } from "../src/lib/cyberware.ts";
import { getCatalogItem } from "../src/data/items.ts";
import { SPECIAL_MOVES } from "../src/data/specialMoves.ts";
import { getSkillBase } from "../src/lib/calculations.ts";
import { normalizeCharacter } from "../src/lib/storage.ts";
import {
  canUpgradeSpecialization,
  getMartialArtsPoints,
  upgradeSpecialization,
} from "../src/lib/progression.ts";
import {
  DEFAULT_TURN_STATE,
  getSpecialMovePoints,
  listSpecialMoveAvailability,
  refundSpecialMove,
  resolveSpecialMove,
  unlockSpecialMove,
  type TurnState,
} from "../src/lib/specialMoves.ts";
import type { DamageRollResult } from "../src/types/attack.ts";
import type { Character } from "../src/types/character.ts";

/** Ficha de teste: DEX/BODY/WILL/MOVE altos e três formas compradas (Karate 4, Aikido 3, Taekwondo 2).
 * Todos os Special Moves já estão desbloqueados (1 ponto por move pago). */
function fighter(): Character {
  const base = createEmptyCharacter("martial-arts");
  const character: Character = {
    ...base,
    stats: { ...base.stats, DEX: 5, BODY: 5, WILL: 8, MOVE: 8 },
    skills: {
      ...base.skills,
      martial_arts: { ...base.skills.martial_arts, level: 7 },
      brawling: { ...base.skills.brawling, level: 2 },
      martial_arts_karate: { ...base.skills.martial_arts_karate, level: 4 },
      martial_arts_aikido: { ...base.skills.martial_arts_aikido, level: 3 },
      martial_arts_taekwondo: {
        ...base.skills.martial_arts_taekwondo,
        level: 2,
      },
    },
    unlockedSpecialMoves: SPECIAL_MOVES.map((move) => move.id),
  };
  return character;
}

function withStats(
  character: Character,
  stats: Partial<Character["stats"]>,
): Character {
  return { ...character, stats: { ...character.stats, ...stats } };
}

function withImplant(character: Character, catalogId: string): Character {
  const item = getCatalogItem(catalogId);
  assert.ok(item, `Item de catálogo inexistente: ${catalogId}`);
  return installCyberware(character, {
    id: crypto.randomUUID(),
    catalogItemId: item.id,
    name: item.name,
    category: "cyberware",
    quantity: 1,
  }).character;
}

function withRandom<T>(value: number, run: () => T): T {
  const originalRandom = Math.random;
  Math.random = () => value;
  try {
    return run();
  } finally {
    Math.random = originalRandom;
  }
}

/** d10 = floor(0.5 * 10) + 1 = 6 · d6 = floor(0.5 * 6) + 1 = 4 */
const NEUTRAL_RANDOM = 0.5;

test("fichas antigas sem forma de Martial Arts recebem as skills padrões sem quebrar a UI", () => {
  const base = createEmptyCharacter("legacy-ma");
  const legacy: Character = {
    ...base,
    skills: {
      ...base.skills,
      martial_arts: { ...base.skills.martial_arts, level: 3 },
    } as Character["skills"],
  };
  delete (legacy.skills as Record<string, unknown>).martial_arts_karate;
  delete (legacy.skills as Record<string, unknown>).martial_arts_taekwondo;
  delete (legacy.skills as Record<string, unknown>).martial_arts_judo;
  delete (legacy.skills as Record<string, unknown>).martial_arts_aikido;

  const normalized = normalizeCharacter(legacy);
  assert.ok(
    normalized.skills.martial_arts_karate,
    "a forma padrão deve ser recriada",
  );
  assert.strictEqual(
    normalized.skills.martial_arts_karate.level,
    0,
    "a especialização ausente começa em zero",
  );
  assert.strictEqual(
    getSkillBase(normalized, "martial_arts_karate"),
    normalized.stats.DEX,
    "a base não pode quebrar a renderização",
  );
});

test("dano de Brawling e Artes Marciais segue a escala oficial de BODY", () => {
  const scale: { body: number; expected: string }[] = [
    { body: 2, expected: "1d6" },
    { body: 4, expected: "1d6" },
    { body: 5, expected: "2d6" },
    { body: 6, expected: "2d6" },
    { body: 7, expected: "3d6" },
    { body: 10, expected: "3d6" },
    { body: 11, expected: "4d6" },
  ];

  for (const caso of scale) {
    const character = withStats(fighter(), { BODY: caso.body });
    for (const context of [
      { type: "brawling" as const, skillId: "brawling" },
      { type: "martial_arts" as const, skillId: "martial_arts_karate" },
    ]) {
      const resolution = rollAttack(character, context);
      assert.ok("result" in resolution, `BODY ${caso.body}: ataque falhou`);
      assert.strictEqual(
        resolution.result.damageDice,
        caso.expected,
        `BODY ${caso.body} em ${context.type}`,
      );
    }
    assert.strictEqual(
      getUnarmedDamageDice(caso.body),
      caso.expected,
      "fonte única da escala",
    );
  }
});

test("cyberarm garante piso de 2d6 sem apagar o +1d6 do item", () => {
  const weakBody = withStats(fighter(), { BODY: 2 });

  // Sem cyberarm: BODY 2 fica em 1d6.
  assert.strictEqual(getUnarmedDamageDice(2), "1d6");
  assert.strictEqual(getUnarmedDamageDice(2, 0, false), "1d6");

  // Cyberarm sozinho: piso de 2d6.
  assert.strictEqual(getUnarmedDamageDice(2, 0, true), "2d6");

  // Gorilla Arms (+1d6) em BODY 2: 1d6 + 1d6 = 2d6 (nada muda, o piso já é atingido).
  const gorillaWeak = withImplant(weakBody, "gorilla_arms");
  const weakAttack = rollAttack(gorillaWeak, {
    type: "brawling",
    skillId: "brawling",
  });
  assert.ok("result" in weakAttack);
  assert.strictEqual(weakAttack.result.damageDice, "2d6");
  assert.deepStrictEqual(weakAttack.result.damageSources, [
    "Base (BODY 2): 1d6",
    "Gorilla Arms: +1d6",
  ]);

  // BODY 5 + Gorilla Arms: 2d6 + 1d6 = 3d6 — o piso não corta o bônus do item.
  const gorillaStrong = withImplant(
    withStats(fighter(), { BODY: 5 }),
    "gorilla_arms",
  );
  const strongAttack = rollAttack(gorillaStrong, {
    type: "brawling",
    skillId: "brawling",
  });
  assert.ok("result" in strongAttack);
  assert.strictEqual(strongAttack.result.damageDice, "3d6");
  assert.deepStrictEqual(strongAttack.result.damageSources, [
    "Base (BODY 5): 2d6",
    "Gorilla Arms: +1d6",
  ]);
});

test("a especialização sobe pelo bolso da perícia-mãe e respeita o saldo disponível", () => {
  const base = createEmptyCharacter("ma-progression");
  const character: Character = {
    ...base,
    skills: {
      ...base.skills,
      martial_arts: { ...base.skills.martial_arts, level: 4 },
      martial_arts_karate: { ...base.skills.martial_arts_karate, level: 1 },
      martial_arts_judo: { ...base.skills.martial_arts_judo, level: 1 },
    },
  };

  assert.deepStrictEqual(getMartialArtsPoints(character), {
    total: 4,
    spentSpecializations: 2,
    spentMoves: 0,
    free: 2,
    balance: 2,
  });
  assert.ok(
    canUpgradeSpecialization(character, "martial_arts_karate"),
    "Karate 1 pode subir para 2 com 2 pontos de Martial Arts",
  );

  const upgraded = upgradeSpecialization(character, "martial_arts_karate");
  assert.ok(upgraded, "o upgrade da especialização deve aplicar");
  assert.strictEqual(upgraded!.skills.martial_arts_karate.level, 2);
  assert.strictEqual(
    getMartialArtsPoints(upgraded!).free,
    0,
    "o saldo cai a zero após gastar o custo do próximo nível",
  );
  assert.strictEqual(
    canUpgradeSpecialization(upgraded!, "martial_arts_karate"),
    false,
    "não permite gastar além do saldo",
  );
});

test("cada forma de Martial Arts é uma perícia própria e nunca soma", () => {
  const character = fighter();
  const attacks = getAvailableAttacks(character);
  const karate = attacks.find(
    (attack) => attack.id === "skill:martial_arts_karate",
  );
  const aikido = attacks.find(
    (attack) => attack.id === "skill:martial_arts_aikido",
  );

  assert.ok(karate, "Karate 4 deve aparecer na lista de ataques");
  assert.ok(aikido, "Aikido 3 deve aparecer na lista de ataques");
  assert.strictEqual(karate!.label, "Martial Arts (Karate)");
  assert.strictEqual(karate!.rof, 2, "Brawling e Martial Arts têm ROF 2");
  assert.strictEqual(aikido!.rof, 2);
  assert.ok(
    attacks.find((attack) => attack.id === "skill:brawling")?.rof === 2,
  );

  // A genérica não aparece junto das formas: para usar Artes Marciais vale a forma escolhida.
  assert.ok(!attacks.some((attack) => attack.id === "skill:martial_arts"));

  withRandom(NEUTRAL_RANDOM, () => {
    const karateRoll = rollAttack(character, karate!.context);
    assert.ok("result" in karateRoll);
    assert.strictEqual(karateRoll.result.skill.id, "martial_arts_karate");
    assert.strictEqual(
      karateRoll.result.skill.value,
      4,
      "usa só o nível de Karate",
    );
    assert.strictEqual(
      karateRoll.result.total,
      karateRoll.result.stat.value +
        karateRoll.result.skill.value +
        karateRoll.result.roll.total,
      "Karate 4 não some com Aikido 3",
    );

    const aikidoRoll = rollAttack(character, aikido!.context);
    assert.ok("result" in aikidoRoll);
    assert.strictEqual(aikidoRoll.result.skill.value, 3, "Aikido rola com 3");
    assert.strictEqual(
      aikidoRoll.result.label,
      "Artes Marciais",
      "rótulo continua vindo do tipo do ataque",
    );
  });
});

test("sem ponto na forma o ataque da forma não existe na lista", () => {
  const character = createEmptyCharacter("sem-forma");
  character.skills = {
    ...character.skills,
    martial_arts: { ...character.skills.martial_arts, level: 4 },
  };

  const attacks = getAvailableAttacks(character);
  assert.ok(
    !attacks.some((attack) => attack.id.startsWith("skill:martial_arts_")),
    "nenhuma forma com nível",
  );
  const generic = attacks.find((attack) => attack.id === "skill:martial_arts");
  assert.ok(
    generic,
    "a ficha antiga com Martial Arts genérica continua funcionando",
  );
});

test("Martial Arts ignora metade do SP da armadura (arredondando para cima)", () => {
  const target = createEmptyCharacter("alvo");
  target.combat.armor = { head: 11, body: 11 };

  const buildDamage = (
    attackType: DamageRollResult["attackType"],
  ): DamageRollResult => ({
    attackId: "attack-1",
    attackName: "Teste",
    attackType,
    damageDice: "2d6",
    roll: { expression: "2d6", rolls: [6, 6], total: 12 },
    total: 12,
  });

  const martialDamage = applyAttackDamage(
    target,
    buildDamage("martial_arts"),
    "body",
  );
  assert.ok("character" in martialDamage);
  assert.strictEqual(
    martialDamage.result.spHalvedByMartialArts,
    true,
    "a regra fica marcada no resultado",
  );
  assert.strictEqual(martialDamage.result.armorSPBefore, 6, "ceil(11 / 2) = 6");
  assert.strictEqual(martialDamage.result.damageAbsorbed, 6);
  assert.strictEqual(martialDamage.result.damageToHP, 6, "12 − 6");

  const brawlingDamage = applyAttackDamage(
    target,
    buildDamage("brawling"),
    "body",
  );
  assert.ok("character" in brawlingDamage);
  assert.strictEqual(
    brawlingDamage.result.armorSPBefore,
    11,
    "Brawling não ignora SP",
  );
  assert.strictEqual(brawlingDamage.result.damageToHP, 1, "12 − 11");

  const weaponDamage = applyAttackDamage(target, buildDamage("melee"), "body");
  assert.ok("character" in weaponDamage);
  assert.strictEqual(
    weaponDamage.result.armorSPBefore,
    11,
    "arma branca não ignora SP",
  );
});

test("o tipo do ataque sobrevive até a rolagem de dano (é o que liga a regra de SP)", () => {
  const character = fighter();
  const attacks = getAvailableAttacks(character);
  const karate = attacks.find(
    (attack) => attack.id === "skill:martial_arts_karate",
  )!;

  const resolution = rollAttack(character, karate.context);
  assert.ok("result" in resolution);

  const damage = rollDamage(resolution.result);
  assert.ok(!("error" in damage));
  assert.strictEqual(damage.attackType, "martial_arts");

  // O botão "Rolar Dano" da ficha usa character.lastAttack.
  const fromLastAttack = rollDamageForLastAttack(resolution.character);
  assert.ok("result" in fromLastAttack);
  assert.strictEqual(fromLastAttack.result.attackType, "martial_arts");
});

test("Special Moves: disponibilidade é calculada a partir de perícia, atributos e flags", () => {
  const semForma = createEmptyCharacter("sem-forma");
  const recoverySemForma = listSpecialMoveAvailability(
    semForma,
    DEFAULT_TURN_STATE,
  ).find((entry) => entry.move.id === "recovery")!;
  assert.strictEqual(recoverySemForma.available, false);
  assert.ok(
    recoverySemForma.missing.some((reason) =>
      reason.includes("forma de Martial Arts"),
    ),
  );

  const character = fighter();
  const availability = listSpecialMoveAvailability(
    character,
    DEFAULT_TURN_STATE,
  );
  assert.strictEqual(
    availability.length,
    SPECIAL_MOVES.length,
    "todos os moves aparecem, com o motivo do bloqueio",
  );

  const byId = new Map(availability.map((entry) => [entry.move.id, entry]));

  // Sem estado de turno nenhum move dependente de turno está liberado.
  assert.strictEqual(
    byId.get("recovery")!.available,
    true,
    "Recovery não tem requisito",
  );
  assert.strictEqual(
    byId.get("bone_breaking_strike")!.available,
    true,
    "WILL 8+ ok",
  );
  assert.strictEqual(byId.get("flying_kick")!.available, false);
  assert.ok(
    byId.get("flying_kick")!.missing.some((reason) => reason.includes("4m")),
  );

  const disarm = byId.get("disarming_combination")!;
  assert.strictEqual(disarm.available, false);
  assert.strictEqual(
    disarm.missing.length,
    2,
    "faltam os dois acertos do turno",
  );

  // Movimentar 4m libera o Flying Kick (MOVE 8+ já está ok).
  const andando: TurnState = { ...DEFAULT_TURN_STATE, movedMeters: 4 };
  assert.strictEqual(
    listSpecialMoveAvailability(character, andando).find(
      (entry) => entry.move.id === "flying_kick",
    )!.available,
    true,
  );

  // Flags do turno liberam Disarming Combination.
  const acertouTudo: TurnState = {
    ...DEFAULT_TURN_STATE,
    hitBrawling: true,
    hitMartialArts: true,
  };
  assert.strictEqual(
    listSpecialMoveAvailability(character, acertouTudo).find(
      (entry) => entry.move.id === "disarming_combination",
    )!.available,
    true,
  );

  // WILL baixo bloqueia Bone Breaking Strike.
  const semWill = withStats(character, { WILL: 7 });
  assert.strictEqual(
    listSpecialMoveAvailability(semWill, DEFAULT_TURN_STATE).find(
      (entry) => entry.move.id === "bone_breaking_strike",
    )!.available,
    false,
  );
});

test("Special Move de cheque usa a perícia da forma e compara com o DV", () => {
  const character = fighter();
  const acertouTudo: TurnState = {
    ...DEFAULT_TURN_STATE,
    hitBrawling: true,
    hitMartialArts: true,
  };
  const recovery = SPECIAL_MOVES.find((move) => move.id === "recovery")!;
  const disarming = SPECIAL_MOVES.find(
    (move) => move.id === "disarming_combination",
  )!;

  withRandom(NEUTRAL_RANDOM, () => {
    // Recovery é compartilhado: usa a melhor forma (Karate 4) — DEX 5 + 4 + d10 6 = 15 vs DV 13.
    const outcome = resolveSpecialMove(character, recovery, DEFAULT_TURN_STATE);
    assert.ok(!("error" in outcome));
    assert.strictEqual(outcome.kind, "check");
    if (outcome.kind === "check") {
      assert.strictEqual(outcome.skill.skillId, "martial_arts_karate");
      assert.strictEqual(outcome.total, 15);
      assert.strictEqual(outcome.dv, 13);
      assert.strictEqual(outcome.success, true);
      assert.strictEqual(
        outcome.character.rollHistory[0].label,
        "Special Move: Recovery",
      );
      assert.match(
        outcome.character.rollHistory[0].expression,
        /vs DV 13 → SUCESSO/,
      );
    }

    // Disarming Combination rola com Aikido 3: DEX 5 + 3 + 6 = 14 vs DV 15 → falha.
    const aikido = {
      ...character,
      skills: {
        ...character.skills,
        martial_arts_karate: {
          ...character.skills.martial_arts_karate,
          level: 0,
        },
      },
    };
    const aikidoOnly = resolveSpecialMove(aikido, disarming, acertouTudo);
    assert.ok(!("error" in aikidoOnly));
    if (aikidoOnly.kind === "check") {
      assert.strictEqual(aikidoOnly.skill.skillId, "martial_arts_aikido");
      assert.strictEqual(aikidoOnly.total, 14);
      assert.strictEqual(aikidoOnly.success, false);
    }
  });
});

test("Special Move bloqueado devolve o motivo em vez de rolar", () => {
  const semWill = withStats(fighter(), { WILL: 7 });
  const boneBreaking = SPECIAL_MOVES.find(
    (move) => move.id === "bone_breaking_strike",
  )!;
  const outcome = resolveSpecialMove(semWill, boneBreaking, DEFAULT_TURN_STATE);
  assert.ok("error" in outcome);
  assert.match(outcome.error, /WILL 8\+/);
});

test("Special Move de ataque vira um ataque de Artes Marciais normal (dano por BODY + metade de SP)", () => {
  const character = fighter();
  const boneBreaking = SPECIAL_MOVES.find(
    (move) => move.id === "bone_breaking_strike",
  )!;
  const flyingKick = SPECIAL_MOVES.find((move) => move.id === "flying_kick")!;
  const andando: TurnState = { ...DEFAULT_TURN_STATE, movedMeters: 4 };

  withRandom(NEUTRAL_RANDOM, () => {
    const outcome = resolveSpecialMove(
      character,
      boneBreaking,
      DEFAULT_TURN_STATE,
    );
    assert.ok(!("error" in outcome));
    assert.strictEqual(outcome.kind, "attack");
    if (outcome.kind === "attack") {
      assert.strictEqual(outcome.attack.label, "Bone Breaking Strike");
      assert.strictEqual(
        outcome.attack.skill.id,
        "martial_arts_karate",
        "usa a skill da forma correspondente",
      );
      assert.strictEqual(outcome.attack.skill.value, 4);
      assert.strictEqual(
        outcome.attack.attackType,
        "martial_arts",
        "entra na regra de metade do SP",
      );
      assert.strictEqual(
        outcome.attack.damageDice,
        "2d6",
        "dano normal de Artes Marciais (BODY 5)",
      );
      assert.strictEqual(
        outcome.character.rollHistory[0].label,
        "Bone Breaking Strike",
      );
    }

    // Com mira na cabeça o teste leva −8 e a ficha mostra a mira.
    const headshot = resolveSpecialMove(
      character,
      boneBreaking,
      DEFAULT_TURN_STATE,
      { headAim: true },
    );
    assert.ok(!("error" in headshot));
    if (headshot.kind === "attack") {
      assert.ok(
        headshot.attack.modifiers.some(
          (modifier) =>
            modifier.source === "Mira na cabeça" && modifier.value === -8,
        ),
      );
      assert.strictEqual(headshot.attack.total, 15 - 8);
    }

    // Flying Kick exige MOVE 8+ e 4m no turno.
    const blocked = resolveSpecialMove(
      character,
      flyingKick,
      DEFAULT_TURN_STATE,
    );
    assert.ok("error" in blocked);
    assert.match(blocked.error, /4m/);

    const kick = resolveSpecialMove(character, flyingKick, andando);
    assert.ok(!("error" in kick));
    if (kick.kind === "attack") {
      assert.strictEqual(kick.attack.skill.id, "martial_arts_taekwondo");
      assert.strictEqual(kick.attack.skill.value, 2);
      assert.strictEqual(kick.attack.damageDice, "2d6");
      // O fluxo de dano da ficha funciona e carrega o tipo do ataque.
      const damage = rollDamageForLastAttack(kick.character);
      assert.ok("result" in damage);
      assert.strictEqual(damage.result.attackType, "martial_arts");
    }
  });
});

test("Special Move travado: 1 ponto por move, pago do bolso único de Martial Arts", () => {
  const base = createEmptyCharacter("unlock");
  const character: Character = {
    ...base,
    stats: { ...base.stats, DEX: 5, WILL: 8 },
    skills: {
      ...base.skills,
      martial_arts: { ...base.skills.martial_arts, level: 3 },
      martial_arts_karate: { ...base.skills.martial_arts_karate, level: 1 },
    },
  };
  const bone = SPECIAL_MOVES.find(
    (move) => move.id === "bone_breaking_strike",
  )!;
  const armor = SPECIAL_MOVES.find(
    (move) => move.id === "armor_breaking_combination",
  )!;

  // Tem ponto na forma, mas não pagou o move → travado, porém canUnlock = true.
  const travado = listSpecialMoveAvailability(
    character,
    DEFAULT_TURN_STATE,
  ).find((entry) => entry.move.id === bone.id)!;
  assert.strictEqual(travado.unlocked, false);
  assert.strictEqual(travado.canUnlock, true);
  assert.strictEqual(
    travado.available,
    false,
    "requisitos ok, mas o move não foi pago",
  );
  assert.deepStrictEqual(travado.points, {
    total: 3,
    balance: 2,
    spentSpecializations: 1,
    spentMoves: 0,
    free: 2,
  });

  const pago = unlockSpecialMove(character, bone);
  assert.ok(pago);
  assert.deepStrictEqual(pago.unlockedSpecialMoves, [bone.id]);

  const depois = listSpecialMoveAvailability(pago, DEFAULT_TURN_STATE);
  const bonePago = depois.find((entry) => entry.move.id === bone.id)!;
  assert.strictEqual(bonePago.unlocked, true);
  assert.strictEqual(bonePago.available, true, "pago + WILL 8+ → usável");
  assert.strictEqual(bonePago.points!.free, 1);

  // Outro move da mesma forma também pode ser desbloqueado (bolso compartilhado).
  const segundo = depois.find((entry) => entry.move.id === armor.id)!;
  assert.strictEqual(segundo.canUnlock, true);
  const pagoArmor = unlockSpecialMove(pago, armor)!;

  // Subir a forma para 2 custa 2 pontos → specs 1+2=3, moves 2 → livre = 3−3−2 = 0.
  const karate2: Character = {
    ...pagoArmor,
    skills: {
      ...pagoArmor.skills,
      martial_arts_karate: {
        ...pagoArmor.skills.martial_arts_karate,
        level: 2,
      },
    },
  };
  assert.strictEqual(getSpecialMovePoints(karate2)!.free, 0);

  // Devolver o ponto desfaz o desbloqueio.
  const devolvido = refundSpecialMove(pagoArmor, bone);
  assert.ok(devolvido);
  assert.deepStrictEqual(devolvido.unlockedSpecialMoves, [armor.id]);
  assert.strictEqual(
    listSpecialMoveAvailability(devolvido, DEFAULT_TURN_STATE).find(
      (entry) => entry.move.id === bone.id,
    )!.canUnlock,
    true,
  );
  assert.strictEqual(refundSpecialMove(devolvido, bone), null, "já devolvido");
});

test("Recovery usa o bolso único de Martial Arts e formas sem nível não desbloqueiam", () => {
  const character = fighter();
  const judoMove = SPECIAL_MOVES.find((move) => move.id === "counter_throw")!;

  const recoveryPoints = getSpecialMovePoints(character)!;
  const recoveryAvail = listSpecialMoveAvailability(
    character,
    DEFAULT_TURN_STATE,
  ).find((entry) => entry.move.id === "recovery")!;
  assert.strictEqual(
    recoveryAvail.skill?.skillId,
    "martial_arts_karate",
    "a melhor forma é Karate 4",
  );
  assert.strictEqual(recoveryPoints.total, 7);
  assert.strictEqual(
    recoveryPoints.free,
    0,
    "tudo gasto: 19 em especializações + 9 moves",
  );

  // Judo não foi comprada (nível 0): não dá pra desbloquear moves dela (perícia ausente).
  const judoAvail = listSpecialMoveAvailability(
    character,
    DEFAULT_TURN_STATE,
  ).find((entry) => entry.move.id === "counter_throw")!;
  assert.strictEqual(judoAvail.skill, undefined);
  assert.strictEqual(judoAvail.points.total, 7);
  assert.strictEqual(judoAvail.points.free, 0);
  assert.strictEqual(unlockSpecialMove(character, judoMove), null);
});

test("Special Move não pago recusa com o aviso de desbloqueio", () => {
  // Ficha antiga: sem o campo, tudo vira "nenhum desbloqueado".
  const character = { ...fighter() };
  delete character.unlockedSpecialMoves;
  const bone = SPECIAL_MOVES.find(
    (move) => move.id === "bone_breaking_strike",
  )!;

  const outcome = resolveSpecialMove(character, bone, DEFAULT_TURN_STATE);
  assert.ok("error" in outcome);
  assert.match(outcome.error, /travado/);
  assert.match(outcome.error, /1 ponto de Martial Arts/);

  // Sem o campo desbloqueado, os pontos continuam contando pelo nível de Martial Arts (7).
  const recovery = listSpecialMoveAvailability(
    character,
    DEFAULT_TURN_STATE,
  ).find((entry) => entry.move.id === "recovery")!;
  assert.strictEqual(recovery.unlocked, false);
  assert.strictEqual(recovery.points!.total, 7);
});
