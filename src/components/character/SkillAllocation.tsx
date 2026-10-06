"use client";

import { CHARACTER_CREATION_RULES } from "@/data/characterCreation";
import { isMartialArtFormSkill, skillDefinitions } from "@/data/skills";
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
    .filter(([, skills]) => skills.length > 0)
    // Largest-first (LPT): distribuir blocos grandes antes evita que eles
    // acabem concentrados no mesmo trilho depois dos blocos menores.
    .sort((a, b) => b[1].length - a[1].length);

  // Balance stats into 4 columns to minimize vertical waste on wide screens.
  // CSS collapses the rails to 2/1 columns at narrower breakpoints.
  const columns: (typeof skillsByStat)[] = [[], [], [], []];
  const columnCounts = [0, 0, 0, 0];
  for (const item of skillsByStat) {
    const target = columnCounts.indexOf(Math.min(...columnCounts));
    columns[target].push(item);
    // Cada grupo também tem um cabeçalho; contar esse custo deixa a altura
    // estimada mais próxima da altura visual real da seção.
    columnCounts[target] += item[1].length + 1;
  }

  function renderStatGroup([stat, skills]: readonly [AttributeName, readonly [string, typeof skillDefinitions[string]][]]) {
    return (
      <section className="skill-allocation-group" key={stat}>
        <div className="skill-group-header">
          <span className="skill-group-stat">{stat}</span>
          <span className="skill-group-name">{statLabels[stat]}</span>
          <span className="skill-group-count">{skills.length}</span>
        </div>
        <div className="skill-group-list">
          {skills.map(([id, definition]) => {
            const skill = character.skills[id];
            const minimum = definition.creation.minimumLevel;
            const isRequired = minimum > 0;
            const isDoubleCost = definition.costMultiplier === 2;
            const isMaxed = skill.level >= CHARACTER_CREATION_RULES.skillMaximum;
            const isMin = skill.level <= minimum;
            // Especializações de Martial Arts não compram com pontos de criação: só com
            // pontos gerados pelos níveis da perícia-mãe, depois da criação.
            const isSpecialization = isMartialArtFormSkill(id);
            return (
              <div className={`skill-alloc-card ${isRequired ? 'required' : ''} ${isMaxed ? 'maxed' : ''}`} key={id}>
                <div className="skill-alloc-info">
                  <span className="skill-alloc-name">{definition.name}</span>
                  <div className="skill-alloc-tags">
                    {isRequired && <span className="skill-tag required">mín. {minimum}</span>}
                    {isDoubleCost && !isSpecialization && <span className="skill-tag double">×2</span>}
                    {isSpecialization && (
                      <span className="skill-tag spec" title="Especialização de Martial Arts: sobe com pontos da perícia-mãe, na ficha da personagem">
                        esp.
                      </span>
                    )}
                  </div>
                </div>
                <div className="skill-alloc-controls">
                  <button type="button" className="skill-alloc-btn decrease" onClick={() => onChange(id, -1)} disabled={!canDecreaseSkill(character, id)} aria-label={`Diminuir ${definition.name}`}>−</button>
                  <span className="skill-alloc-value">{skill.level}</span>
                  <button
                    type="button"
                    className="skill-alloc-btn increase"
                    onClick={() => onChange(id, 1)}
                    disabled={isSpecialization || !canIncreaseSkill(character, id)}
                    title={isSpecialization ? "Especialização: sobe na ficha com pontos de Martial Arts" : undefined}
                    aria-label={`Aumentar ${definition.name}`}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <div className="skill-allocation-balanced">
      {columns.map((column, index) => (
        <div className="skill-allocation-column" key={index}>
          {column.map(renderStatGroup)}
        </div>
      ))}
    </div>
  );
}
