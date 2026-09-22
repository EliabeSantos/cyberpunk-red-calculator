"use client";

import { ATTRIBUTE_CREATION_RULES } from "@/data/characterCreation";
import {
  canDecreaseAttribute,
  canIncreaseAttribute,
} from "@/lib/characterCreation";
import {
  statNames,
  type AttributeName,
  type Character,
} from "@/types/character";

const labels: Record<AttributeName, string> = {
  INT: "Inteligência",
  REF: "Reflexos",
  DEX: "Destreza",
  TECH: "Técnica",
  COOL: "Frieza",
  WILL: "Vontade",
  LUCK: "Sorte",
  MOVE: "Movimento",
  BODY: "Corpo",
  EMP: "Empatia",
};

const statIcons: Record<AttributeName, string> = {
  INT: "🧠",
  REF: "⚡",
  DEX: "🏃",
  TECH: "🔧",
  COOL: "😎",
  WILL: "💪",
  LUCK: "🍀",
  MOVE: "👣",
  BODY: "💪",
  EMP: "❤️",
};

type Props = {
  character: Character;
  onChange: (attribute: AttributeName, delta: 1 | -1) => void;
};

export default function AttributeAllocation({ character, onChange }: Props) {
  // Split attributes into two balanced groups
  const primaryAttrs: AttributeName[] = ["INT", "REF", "DEX", "TECH", "COOL"];
  const secondaryAttrs: AttributeName[] = ["WILL", "LUCK", "MOVE", "BODY", "EMP"];

  function renderAttrCard(attribute: AttributeName) {
    const rule = ATTRIBUTE_CREATION_RULES[attribute];
    const value = character.stats[attribute];
    const canUp = canIncreaseAttribute(character, attribute);
    const canDown = canDecreaseAttribute(character, attribute);
    const isMin = value <= rule.minimum;
    const isMax = value >= rule.maximum;

    return (
      <div className="attr-card" key={attribute}>
        <div className="attr-card-header">
          <span className="attr-icon">{statIcons[attribute]}</span>
          <div className="attr-info">
            <span className="attr-abbr">{attribute}</span>
            <span className="attr-name">{labels[attribute]}</span>
          </div>
        </div>
        <div className="attr-card-value">
          <span className="attr-number">{value}</span>
        </div>
        <div className="attr-card-controls">
          <button
            type="button"
            className="attr-btn decrease"
            onClick={() => onChange(attribute, -1)}
            disabled={!canDown}
            aria-label={`Diminuir ${labels[attribute]}`}
          >
            −
          </button>
          <button
            type="button"
            className="attr-btn increase"
            onClick={() => onChange(attribute, 1)}
            disabled={!canUp}
            aria-label={`Aumentar ${labels[attribute]}`}
          >
            +
          </button>
        </div>
        <div className="attr-range">
          <span className={isMin ? 'at-limit' : ''}>{rule.minimum}</span>
          <span className="range-separator">–</span>
          <span className={isMax ? 'at-limit' : ''}>{rule.maximum}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="attributes-layout">
      <div className="attributes-column">
        {primaryAttrs.map(renderAttrCard)}
      </div>
      <div className="attributes-column">
        {secondaryAttrs.map(renderAttrCard)}
      </div>
    </div>
  );
}
