"use client";

import { CHARACTER_CREATION_RULES } from "@/data/characterCreation";
import { skillDefinitions } from "@/data/skills";
import { canDecreaseSkill, canIncreaseSkill } from "@/lib/characterCreation";
import { statNames, type AttributeName, type Character } from "@/types/character";

const statLabels: Record<AttributeName, string> = {
  INT: "Inteligência", REF: "Reflexos", DEX: "Destreza", TECH: "Técnica", COOL: "Frieza",
  WILL: "Vontade", LUCK: "Sorte", MOVE: "Movimento", BODY: "Corpo", EMP: "Empatia",
};
type Props = { character: Character; onChange: (skillId: string, delta: 1 | -1) => void };

export default function SkillAllocation({ character, onChange }: Props) {
  const skillsByStat = statNames
    .map((stat) => [stat, Object.entries(skillDefinitions).filter(([, definition]) => definition.stat === stat)] as const)
    .filter(([, skills]) => skills.length > 0);

  return (
    <div className="skill-allocation-list">
      {skillsByStat.map(([stat, skills]) => (
        <section className="skill-allocation-group" key={stat}>
          <h3>{stat} <small>{statLabels[stat]}</small></h3>
          {skills.map(([id, definition]) => {
            const skill = character.skills[id];
            const minimum = definition.creation.minimumLevel;
            return (
              <div className="skill-allocation-row" key={id}>
                <div>
                  <strong>{definition.name}</strong>
                  <small>
                    máximo {CHARACTER_CREATION_RULES.skillMaximum}
                    {definition.costMultiplier === 2 ? " · custo x2" : ""}
                    {minimum > 0 ? ` · mínimo obrigatório ${minimum}` : ""}
                  </small>
                </div>
                <div className="stepper">
                  <button type="button" onClick={() => onChange(id, -1)} disabled={!canDecreaseSkill(character, id)} aria-label={`Diminuir ${definition.name}`}>−</button>
                  <output>{skill.level}</output>
                  <button type="button" onClick={() => onChange(id, 1)} disabled={!canIncreaseSkill(character, id)} aria-label={`Aumentar ${definition.name}`}>+</button>
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}