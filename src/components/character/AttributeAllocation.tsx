"use client";

import { ATTRIBUTE_CREATION_RULES } from "@/data/characterCreation";
import { canDecreaseAttribute, canIncreaseAttribute } from "@/lib/characterCreation";
import { attributeNames, type AttributeName, type Character } from "@/types/character";

const labels: Record<AttributeName, string> = { INT: "Inteligência", REF: "Reflexos", DEX: "Destreza", TECH: "Técnica", COOL: "Frieza", WILL: "Vontade", LUCK: "Sorte", MOVE: "Movimento", BODY: "Corpo", EMP: "Empatia" };

type Props = { character: Character; onChange: (attribute: AttributeName, delta: 1 | -1) => void };
export default function AttributeAllocation({ character, onChange }: Props) {
  return <div className="allocation-grid">{attributeNames.map((attribute) => {
    const rule = ATTRIBUTE_CREATION_RULES[attribute];
    return <div className="allocation-row" key={attribute}><div><strong>{attribute}</strong><small>{labels[attribute]} · {rule.minimum}–{rule.maximum}</small></div><div className="stepper"><button type="button" onClick={() => onChange(attribute, -1)} disabled={!canDecreaseAttribute(character, attribute)} aria-label={`Diminuir ${attribute}`}>−</button><output>{character.attributes[attribute]}</output><button type="button" onClick={() => onChange(attribute, 1)} disabled={!canIncreaseAttribute(character, attribute)} aria-label={`Aumentar ${attribute}`}>+</button></div></div>;
  })}</div>;
}