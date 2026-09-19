"use client";

import type { AttackRollResult } from "@/types/attack";
import { rollAttack } from "@/lib/attacks";
import type { Character } from "@/types/character";

type Props = { character: Character; onUpdate: (character: Character) => void; onResult: (result: AttackRollResult) => void; };
export default function AttackActions({ character, onUpdate, onResult }: Props) {
  const attackableWeapons = character.weapons.filter((weapon) => weapon.attackType && weapon.skill);
  function attack(weaponId: string) { const resolution = rollAttack(character, { type: "weapon", weaponId }); if ("error" in resolution) return; onUpdate(resolution.character); onResult(resolution.result); }
  return <div className="attack-actions">{attackableWeapons.length ? attackableWeapons.map((weapon) => <button type="button" key={weapon.id} onClick={() => attack(weapon.id)}><span>{weapon.name}</span><small>{weapon.skill} + 1d10</small><b>Rolar ataque</b></button>) : <p className="sheet-empty">Equipe uma arma com perfil de ataque para rolar.</p>}</div>;
}