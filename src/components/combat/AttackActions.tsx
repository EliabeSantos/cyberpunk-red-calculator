"use client";

import { getAvailableAttacks, rollAttack } from "@/lib/attacks";
import type { AttackRollResult } from "@/types/attack";
import type { Character } from "@/types/character";

type Props = { character: Character; onUpdate: (character: Character) => void; onResult: (result: AttackRollResult) => void };
export default function AttackActions({ character, onUpdate, onResult }: Props) {
  const attacks = getAvailableAttacks(character);
  function attack(attackId: string) { const availableAttack = attacks.find((item) => item.id === attackId); if (!availableAttack) return; const resolution = rollAttack(character, availableAttack.context); if ("error" in resolution) return; onUpdate(resolution.character); onResult(resolution.result); }
  return <div className="attack-actions">{attacks.length ? attacks.map((availableAttack) => <button type="button" key={availableAttack.id} onClick={() => attack(availableAttack.id)}><span>{availableAttack.label}</span><small>{availableAttack.detail}</small><b>Rolar ataque</b></button>) : <p className="sheet-empty">Equipe uma arma ou aumente uma perícia de ataque para rolar.</p>}</div>;
}