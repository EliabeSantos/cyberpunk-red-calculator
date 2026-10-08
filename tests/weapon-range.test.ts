import assert from "node:assert/strict";
import test from "node:test";

import { catalogItems } from "../src/data/items.ts";
import {
  WEAPON_RANGE_PROFILES,
  getWeaponRangeProfile,
  isValidWeaponRangeProfile,
  rangeBandLabel,
  resolveWeaponRangeBand,
} from "../src/lib/combat/weaponRange.ts";
import { tacticalWeaponRangeFeedback } from "../src/lib/mesa/tacticalMap.ts";

const map = { imageUrl: "", enabled: true, width: 1000, height: 600, pixelsPerMeter: 50 };

test("F1.46: todos os perfis canônicos têm faixas contíguas e DVs válidos", () => {
  for (const profile of Object.values(WEAPON_RANGE_PROFILES)) {
    assert.equal(isValidWeaponRangeProfile(profile), true, profile.id);
    for (let index = 1; index < profile.bands.length; index += 1) {
      assert.equal(profile.bands[index].minMeters, profile.bands[index - 1].maxMeters + 1);
    }
    assert.ok(profile.bands.every((band) => band.minMeters >= 0 && band.minMeters <= band.maxMeters && Number.isInteger(band.dv)));
  }
});

test("F1.46: catálogo inteiro de armas à distância declara exatamente um perfil", () => {
  const ranged = catalogItems.filter((item) => item.category === "weapon" && item.subcategory !== "melee");
  assert.ok(ranged.length > 0);
  for (const item of ranged) {
    const profile = getWeaponRangeProfile({ id: item.id, catalogItemId: item.id });
    assert.ok(profile, `${item.id} sem perfil`);
    assert.equal(isValidWeaponRangeProfile(profile), true, `${item.id} perfil inválido`);
  }
});

test("F1.46: limites oficiais do perfil Pistol são determinísticos", () => {
  const profile = WEAPON_RANGE_PROFILES.pistol;
  const at = (distance: number) => resolveWeaponRangeBand(distance, profile);
  const validAt = (distance: number) => {
    const result = at(distance);
    assert.equal(result.status, "valid");
    if (result.status !== "valid") throw new Error(`expected valid range at ${distance}`);
    return result;
  };
  assert.equal(validAt(0).band, "point_blank");
  assert.equal(validAt(6).band, "point_blank");
  assert.equal(validAt(6.01).band, "close");
  assert.equal(validAt(7).band, "close");
  assert.equal(validAt(12).band, "close");
  assert.equal(validAt(12.01).band, "medium");
  assert.equal(validAt(13).band, "medium");
  assert.equal(validAt(200).dv, 30);
  assert.equal(at(200.01).status, "out_of_range");
  assert.equal(rangeBandLabel(validAt(0).band), "Point Blank");
});

test("F1.46: cada perfil resolve limite inferior/superior e transição sem sobreposição", () => {
  for (const profile of Object.values(WEAPON_RANGE_PROFILES)) {
    for (let index = 0; index < profile.bands.length; index += 1) {
      const band = profile.bands[index];
      const lower = resolveWeaponRangeBand(band.minMeters, profile);
      const upper = resolveWeaponRangeBand(band.maxMeters, profile);
      assert.equal(lower.status, "valid");
      assert.equal(upper.status, "valid");
      if (lower.status === "valid") assert.equal(lower.band, band.band);
      if (upper.status === "valid") assert.equal(upper.band, band.band);
      if (index > 0) {
        const before = resolveWeaponRangeBand(band.minMeters - 1, profile);
        assert.equal(before.status, "valid");
        if (before.status === "valid") assert.equal(before.band, profile.bands[index - 1].band);
      }
    }
    const last = profile.bands[profile.bands.length - 1];
    assert.equal(resolveWeaponRangeBand(last.maxMeters + 1, profile).status, "out_of_range");
  }
});

test("F1.46: perfil ausente, perfil inválido e melee não recebem tabela de fogo", () => {
  assert.equal(resolveWeaponRangeBand(7, undefined).status, "undefined");
  assert.equal(resolveWeaponRangeBand(7, { id: "pistol", label: "Pistol", bands: [] }).status, "undefined");
  assert.equal(getWeaponRangeProfile(null), undefined);
  assert.equal(getWeaponRangeProfile({ id: "combat_knife", catalogItemId: "combat_knife" }), undefined);
  assert.equal(resolveWeaponRangeBand(-1, WEAPON_RANGE_PROFILES.pistol).status, "undefined");
});

test("F1.46: Tactical Map usa faixa e DV do mesmo resolver", () => {
  const weapon = { id: "weapon", name: "Heavy Pistol", damage: "3d6", catalogItemId: "heavy_pistol" };
  const feedback = tacticalWeaponRangeFeedback({ x: 0, y: 0 }, { x: 0.14, y: 0 }, map, weapon);
  assert.equal(feedback.distance, 3);
  assert.equal(feedback.withinRange, true);
  assert.equal(feedback.band, "point_blank");
  assert.equal(feedback.dv, 13);

  const far = tacticalWeaponRangeFeedback({ x: 0, y: 0 }, { x: 0.5, y: 0 }, map, weapon);
  assert.equal(far.distance, 10);
  assert.equal(far.band, "close");
  assert.equal(far.dv, 15);
});

test("F1.46: Tactical Map não quebra quando não há arma selecionada", () => {
  const feedback = tacticalWeaponRangeFeedback({ x: 0, y: 0 }, { x: 0.14, y: 0 }, map, null);
  assert.equal(feedback.distance, 3);
  assert.equal(feedback.withinRange, null);
  assert.equal(feedback.rangeMeters, null);
});
