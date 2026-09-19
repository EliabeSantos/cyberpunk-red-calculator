"use client";

import { CHARACTER_CREATION_RULES } from "@/data/characterCreation";
import { skillDefinitions } from "@/data/skills";
import { canDecreaseSkill, canIncreaseSkill } from "@/lib/characterCreation";
import type { Character } from "@/types/character";

type Props = { character: Character; onChange: (skillId: string, delta: 1 | -1) => void };
export default function SkillAllocation({ character, onChange }: Props) {
  return <div className="skill-allocation-list">{Object.entries(skillDefinitions).map(([id, definition]) => {
    const skill = character.skills[id]; const minimum = definition.creation.minimumLevel;
    return <div className="skill-allocation-row" key={id}><div><strong>{definition.name}</strong><small>{definition.stat} · máximo {CHARACTER_CREATION_RULES.skillMaximum}{minimum > 0 ? ` · mínimo obrigatório ${minimum}` : ""}</small></div><div className="stepper"><button type="button" onClick={() => onChange(id, -1)} disabled={!canDecreaseSkill(character, id)} aria-label={`Diminuir ${definition.name}`}>−</button><output>{skill.level}</output><button type="button" onClick={() => onChange(id, 1)} disabled={!canIncreaseSkill(character, id)} aria-label={`Aumentar ${definition.name}`}>+</button></div></div>;
  })}</div>;
}