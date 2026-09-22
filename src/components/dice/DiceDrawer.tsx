"use client";

import { useState } from "react";
import { rollDice } from "@/lib/dice";
import type { RollHistoryEntry } from "@/types/character";

type DiceDrawerProps = {
  open: boolean;
  onClose: () => void;
  rollHistory: RollHistoryEntry[];
  onFreeRoll: (entry: RollHistoryEntry) => void;
};

const PRESETS = [
  { label: "1d4", expr: "1d4" },
  { label: "1d6", expr: "1d6" },
  { label: "2d6", expr: "2d6" },
  { label: "1d8", expr: "1d8" },
  { label: "1d10", expr: "1d10" },
  { label: "1d12", expr: "1d12" },
  { label: "1d20", expr: "1d20" },
  { label: "1d100", expr: "1d100" },
  { label: "3d6", expr: "3d6" },
  { label: "4d6", expr: "4d6" },
  { label: "5d6", expr: "5d6" },
  { label: "2d10", expr: "2d10" },
];

const TYPE_LABELS: Record<RollHistoryEntry["type"], string> = {
  skill_check: "Perícia",
  attack: "Ataque",
  damage: "Dano",
  evasion: "Evasão",
  received_damage: "Dano recebido",
  humanity_loss: "Humanidade",
  free_roll: "Dado livre",
};

const TYPE_ICONS: Record<RollHistoryEntry["type"], string> = {
  skill_check: "🎯",
  attack: "⚔️",
  damage: "💥",
  evasion: "🛡️",
  received_damage: "🩸",
  humanity_loss: "🧠",
  free_roll: "🎲",
};

export default function DiceDrawer({
  open,
  onClose,
  rollHistory,
  onFreeRoll,
}: DiceDrawerProps) {
  const [expression, setExpression] = useState("1d6");
  const [error, setError] = useState("");

  function handleRoll(expr?: string) {
    const target = expr ?? expression;
    setError("");
    try {
      const result = rollDice(target);
      const entry: RollHistoryEntry = {
        id: crypto.randomUUID(),
        type: "free_roll",
        label: target,
        characterId: "",
        expression: result.expression,
        rolls: result.rolls,
        total: result.total,
        timestamp: new Date().toISOString(),
      };
      onFreeRoll(entry);
    } catch {
      setError("Expressão inválida. Use o formato XdY (ex: 2d6, 1d10).");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleRoll();
  }

  function formatEntry(entry: RollHistoryEntry): {
    icon: string;
    typeLabel: string;
    mainLabel: string;
    detail: string;
    rollsStr: string;
    total: number;
    critical?: boolean;
    fumble?: boolean;
  } {
    const icon = TYPE_ICONS[entry.type] ?? "🎲";
    const typeLabel = TYPE_LABELS[entry.type] ?? entry.type;

    let mainLabel = entry.label;
    let detail = entry.expression;
    const rollsStr = entry.rolls.length
      ? `[${entry.rolls.join(", ")}]`
      : "";

    const critical = entry.type === "attack" || entry.type === "skill_check" || entry.type === "evasion"
      ? entry.expression.includes("crítico")
      : undefined;
    const fumble = entry.type === "attack" || entry.type === "skill_check" || entry.type === "evasion"
      ? entry.expression.includes("falha")
      : undefined;

    if (entry.type === "received_damage" && entry.amount !== undefined) {
      detail = `${entry.amount} de dano`;
      if (entry.damageAbsorbed && entry.damageAbsorbed > 0) {
        detail += ` (${entry.damageAbsorbed} absorvido)`;
      }
    }

    if (entry.type === "humanity_loss") {
      if (entry.humanityBefore !== undefined && entry.humanityAfter !== undefined) {
        detail = `${entry.humanityBefore} → ${entry.humanityAfter}`;
      }
    }

    if (entry.type === "free_roll") {
      mainLabel = entry.expression;
      detail = "";
    }

    return { icon, typeLabel, mainLabel, detail, rollsStr, total: entry.total, critical, fumble };
  }

  return (
    <>
      {open && (
        <div className="dice-drawer-backdrop" onClick={onClose} />
      )}
      <aside className={`dice-drawer${open ? " dice-drawer--open" : ""}`}>
        <div className="dice-drawer-header">
          <div>
            <p className="eyebrow">Ferramentas</p>
            <h2>🎲 Dados</h2>
          </div>
          <button
            type="button"
            className="dice-drawer-close"
            onClick={onClose}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="dice-drawer-body">
          <section className="dice-drawer-section">
            <h3>Rolar dado</h3>
            <div className="dice-roll-input">
              <input
                type="text"
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ex: 2d6, 1d10, 4d6"
                className="dice-expression-input"
              />
              <button
                type="button"
                className="dice-roll-button"
                onClick={() => handleRoll()}
              >
                🎲 Rolar
              </button>
            </div>
            {error && <p className="dice-error">{error}</p>}
          </section>

          <section className="dice-drawer-section">
            <h3>Atalhos</h3>
            <div className="dice-presets">
              {PRESETS.map((p) => (
                <button
                  key={p.expr}
                  type="button"
                  className="dice-preset"
                  onClick={() => handleRoll(p.expr)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </section>

          <section className="dice-drawer-section">
            <h3>Histórico ({rollHistory.length})</h3>
            {rollHistory.length === 0 ? (
              <p className="dice-empty">Nenhuma rolagem ainda.</p>
            ) : (
              <div className="dice-history">
                {rollHistory.map((entry) => {
                  const info = formatEntry(entry);
                  return (
                    <div
                      key={entry.id}
                      className="dice-history-entry"
                    >
                      <div className="dice-history-left">
                        <span className="dice-history-icon">{info.icon}</span>
                        <div className="dice-history-info">
                          <span className="dice-history-label">
                            {info.mainLabel}
                            {info.critical && (
                              <span className="dice-history-crit"> ⚡</span>
                            )}
                            {info.fumble && (
                              <span className="dice-history-fumble"> 💥</span>
                            )}
                          </span>
                          <span className="dice-history-meta">
                            <span className="dice-history-type">{info.typeLabel}</span>
                            {info.detail && <> · {info.detail}</>}
                            {info.rollsStr && <> · {info.rollsStr}</>}
                          </span>
                        </div>
                      </div>
                      <span className="dice-history-total">
                        {info.total}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
