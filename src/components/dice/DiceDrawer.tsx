"use client";

import { useState } from "react";
import DiscordIntegrationPanel from "@/components/discord/DiscordIntegrationPanel";
import { rollDice } from "@/lib/dice";
import type { DiscordConsent } from "@/lib/discord/consent";
import { clearSessionCode, getSessionCode, setSessionCode } from "@/lib/discord/session";
import { generateSessionCode, normalizeSessionCode } from "@/lib/discord/sessionCode";
import type { RollHistoryEntry } from "@/types/character";

type DiceDrawerProps = {
  open: boolean;
  onClose: () => void;
  rollHistory: RollHistoryEntry[];
  onFreeRoll: (entry: RollHistoryEntry) => void;
  /** Consentimento atual; "null" = o usuário ainda não respondeu ao pedido. */
  discordConsent: DiscordConsent | null;
  onDiscordConsentChange: (consent: DiscordConsent) => void;
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

type HistoryTab = "all" | "humanity";

export default function DiceDrawer({
  open,
  onClose,
  rollHistory,
  onFreeRoll,
  discordConsent,
  onDiscordConsentChange,
}: DiceDrawerProps) {
  const [expression, setExpression] = useState("1d6");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<HistoryTab>("all");
  const [sessionCodeInput, setSessionCodeInput] = useState(() => getSessionCode() ?? "");
  const [panelOpen, setPanelOpen] = useState(false);
  const discordEnabled = discordConsent === "granted";
  const sessionCode = normalizeSessionCode(sessionCodeInput);

  function handleSessionCodeChange(value: string) {
    setSessionCodeInput(value);
    if (!value.trim()) {
      clearSessionCode();
      return;
    }
    // Persiste apenas quando o valor é um código válido.
    setSessionCode(value);
  }

  function handleGenerateSessionCode() {
    const code = generateSessionCode();
    setSessionCodeInput(code);
    setSessionCode(code);
  }

  const humanityHistory = rollHistory.filter((e) => e.type === "humanity_loss");
  const otherHistory = rollHistory.filter((e) => e.type !== "humanity_loss");
  const displayHistory = activeTab === "humanity" ? humanityHistory : rollHistory;

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
    humanityBefore?: number;
    humanityAfter?: number;
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

    let humanityBefore: number | undefined;
    let humanityAfter: number | undefined;

    if (entry.type === "humanity_loss") {
      if (entry.humanityBefore !== undefined && entry.humanityAfter !== undefined) {
        humanityBefore = entry.humanityBefore;
        humanityAfter = entry.humanityAfter;
        detail = `${entry.humanityBefore} → ${entry.humanityAfter}`;
      }
    }

    if (entry.type === "free_roll") {
      mainLabel = entry.expression;
      detail = "";
    }

    return { icon, typeLabel, mainLabel, detail, rollsStr, total: entry.total, critical, fumble, humanityBefore, humanityAfter };
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
            <h3>Discord</h3>
            <div className="consent-toggle-row">
              <div>
                <span className="consent-toggle-label">Enviar rolagens ao Discord</span>
                <span className={`consent-toggle-state${discordEnabled ? " consent-toggle-state--on" : ""}`}>
                  {discordEnabled ? "Ativado" : "Desativado"}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={discordEnabled}
                aria-label="Enviar rolagens ao Discord"
                className={`consent-switch${discordEnabled ? " consent-switch--on" : ""}`}
                onClick={() => onDiscordConsentChange(discordEnabled ? "denied" : "granted")}
              >
                <span className="consent-switch-thumb" />
              </button>
            </div>

            <div className="discord-session-field">
              <label className="consent-toggle-label" htmlFor="session-code-input">
                Código da mesa
              </label>
              <div className="dice-roll-input">
                <input
                  id="session-code-input"
                  type="text"
                  className="dice-expression-input"
                  value={sessionCodeInput}
                  onChange={(event) => handleSessionCodeChange(event.target.value)}
                  placeholder="ex.: night-city"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button type="button" className="dice-preset" onClick={handleGenerateSessionCode}>
                  Gerar
                </button>
              </div>
              {sessionCodeInput.trim() && !sessionCode && (
                <p className="dice-error">Use 3–48 caracteres: letras, números e hífen.</p>
              )}
            </div>

            <button
              type="button"
              className="dice-roll-button"
              onClick={() => setPanelOpen(true)}
              disabled={!sessionCode}
              style={{ marginTop: "0.6rem", width: "100%" }}
            >
              ⚙ Configurar servidor
            </button>

            <p className="consent-drawer-hint">
              Compartilhe o código da mesa com os jogadores: as rolagens vão apenas para o
              servidor Discord vinculado. O Discord não rola dados.
            </p>

            <DiscordIntegrationPanel
              open={panelOpen}
              onClose={() => setPanelOpen(false)}
              sessionCode={sessionCode ?? ""}
            />
          </section>

          <section className="dice-drawer-section dice-history-section">
            <div className="dice-history-tabs">
              <button
                type="button"
                className={`dice-tab ${activeTab === "all" ? "active" : ""}`}
                onClick={() => setActiveTab("all")}
              >
                Todos ({rollHistory.length})
              </button>
              <button
                type="button"
                className={`dice-tab ${activeTab === "humanity" ? "active" : ""}`}
                onClick={() => setActiveTab("humanity")}
              >
                🧠 Humanidade ({humanityHistory.length})
              </button>
            </div>

            {displayHistory.length === 0 ? (
              <p className="dice-empty">
                {activeTab === "humanity"
                  ? "Nenhuma perda de humanidade registrada."
                  : "Nenhuma rolagem ainda."}
              </p>
            ) : (
              <div className="dice-history">
                {displayHistory.map((entry) => {
                  const info = formatEntry(entry);
                  return (
                    <div
                      key={entry.id}
                      className={`dice-history-entry ${entry.type === "humanity_loss" ? "humanity-entry" : ""}`}
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
                            {info.rollsStr && entry.type !== "humanity_loss" && <> · {info.rollsStr}</>}
                          </span>
                          {entry.type === "humanity_loss" && info.rollsStr && (
                            <span className="dice-history-rolls">
                              {info.rollsStr} = {info.total}
                            </span>
                          )}
                        </div>
                      </div>
                      {entry.type === "humanity_loss" && info.humanityBefore !== undefined && info.humanityAfter !== undefined ? (
                        <div className="humanity-change">
                          <span className="humanity-before">{info.humanityBefore}</span>
                          <span className="humanity-arrow">→</span>
                          <span className={`humanity-after ${info.humanityAfter < info.humanityBefore ? "lost" : "gained"}`}>
                            {info.humanityAfter}
                          </span>
                        </div>
                      ) : (
                        <span className="dice-history-total">
                          {info.total}
                        </span>
                      )}
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
