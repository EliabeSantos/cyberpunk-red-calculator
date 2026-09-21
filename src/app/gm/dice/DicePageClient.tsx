"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { loadEnemies } from "@/lib/gmStorage";
import { rollDice, type DiceResult } from "@/lib/dice";
import { rollEnemyAttack, rollEnemySkillCheck, rollEnemyDamage, getAvailableEnemyAttacks, type EnemyAttackRollResult, type EnemySkillCheckResult, type EnemyDamageRollResult } from "@/lib/enemyRolls";
import type { Enemy } from "@/types/enemy";

export default function DicePageClient() {
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [selectedEnemyId, setSelectedEnemyId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Attack state
  const [lastAttackResult, setLastAttackResult] = useState<EnemyAttackRollResult | null>(null);
  const [lastDamageResult, setLastDamageResult] = useState<EnemyDamageRollResult | null>(null);
  const [selectedAttackId, setSelectedAttackId] = useState<string>("");
  const [attackModifier, setAttackModifier] = useState(0);

  // Skill check state
  const [lastSkillResult, setLastSkillResult] = useState<EnemySkillCheckResult | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string>("");
  const [skillModifier, setSkillModifier] = useState(0);
  const [skillTargetNumber, setSkillTargetNumber] = useState<string>("");

  // Direct damage state
  const [directDamageDice, setDirectDamageDice] = useState("");
  const [lastDirectDamage, setLastDirectDamage] = useState<EnemyDamageRollResult | null>(null);

  useEffect(() => {
    const data = loadEnemies();
    setEnemies(data);
    if (data.length > 0 && !selectedEnemyId) {
      setSelectedEnemyId(data[0].id);
    }
    setLoading(false);
  }, [selectedEnemyId]);

  useEffect(() => {
    if (selectedEnemyId) {
      setLastAttackResult(null);
      setLastDamageResult(null);
      setLastSkillResult(null);
      setLastDirectDamage(null);
      setSelectedAttackId("");
      setSelectedSkillId("");
    }
  }, [selectedEnemyId]);

  const selectedEnemy = enemies.find((e) => e.id === selectedEnemyId);
  const attacks = selectedEnemy ? getAvailableEnemyAttacks(selectedEnemy) : [];
  const skills = selectedEnemy ? Object.entries(selectedEnemy.skills).map(([id, skill]) => ({
    id,
    name: skill.name,
    base: selectedEnemy.stats[skill.stat] + skill.level,
    stat: skill.stat,
  })) : [];

  const handleRollAttack = async (attackId: string) => {
    if (!selectedEnemy) return;
    const attack = attacks.find((a) => a.id === attackId);
    if (!attack) return;

    const modifiers = attackModifier !== 0 ? [{ source: "Modificador GM", value: attackModifier }] : undefined;
    const result = rollEnemyAttack(selectedEnemy, { ...attack.context, modifiers });

    if ("result" in result) {
      setLastAttackResult(result.result);
      setLastDamageResult(null);
    }
  };

  const handleRollDamage = async () => {
    if (!selectedEnemy || !lastAttackResult?.damageDice) return;
    const result = rollEnemyDamage(selectedEnemy, lastAttackResult.damageDice, lastAttackResult.label, lastAttackResult.weaponId);
    if ("result" in result) {
      setLastDamageResult(result.result);
    }
  };

  const handleRollSkill = async () => {
    if (!selectedEnemy || !selectedSkillId) return;
    const modifiers = skillModifier !== 0 ? [{ source: "Modificador GM", value: skillModifier }] : undefined;
    const targetNum = skillTargetNumber !== "" ? Number(skillTargetNumber) : undefined;
    const result = rollEnemySkillCheck(selectedEnemy, {
      type: "skill_check",
      enemyId: selectedEnemy.id,
      skillId: selectedSkillId,
      modifiers,
      targetNumber: targetNum,
    });
    if ("result" in result) {
      setLastSkillResult(result.result);
    }
  };

  const handleRollDirectDamage = async () => {
    if (!selectedEnemy || !directDamageDice.trim()) return;
    try {
      const rollResult = rollDice(directDamageDice);
      const result: EnemyDamageRollResult = {
        enemyId: selectedEnemy.id,
        enemyName: selectedEnemy.identity.name,
        attackName: "Dano Direto",
        damageDice: directDamageDice,
        roll: rollResult,
        total: rollResult.total,
      };
      setLastDirectDamage(result);
    } catch (err) {
      alert("Expressão de dado inválida. Ex: 4d6, 2d6+3, 1d10+5");
    }
  };

  if (loading) {
    return (
      <div className="gm-page">
        <div className="gm-access-loading" role="status">
          <div className="gm-access-spinner" aria-hidden="true"></div>
          <p>Carregando...</p>
        </div>
      </div>
    );
  }

  if (enemies.length === 0) {
    return (
      <div className="gm-page">
        <header className="gm-page-header">
          <h1 className="gm-page-title">Rolagem de Dados</h1>
          <p className="gm-page-subtitle">Role ataques, perícias e dano para seus inimigos</p>
        </header>
        <div className="enemy-list-empty">
          <div className="enemy-list-empty-icon" aria-hidden="true">🎲</div>
          <h3>Nenhum inimigo cadastrado</h3>
          <p>Crie inimigos primeiro para poder rolar dados para eles.</p>
          <Link href="/gm/create" className="enemy-list-create-link">
            <span>+</span> Criar Inimigo
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="gm-page gm-dice-page">
      <header className="gm-page-header">
        <div className="gm-page-header-main">
          <h1 className="gm-page-title">Rolagem de Dados</h1>
          <p className="gm-page-subtitle">Role ataques, perícias e dano para {selectedEnemy?.identity.name || "inimigo selecionado"}</p>
        </div>
        <div className="gm-page-header-actions">
          <Link href="/gm/create" className="gm-button gm-button-secondary">
            + Novo Inimigo
          </Link>
        </div>
      </header>

      {/* Enemy Selector */}
      <div className="gm-dice-enemy-selector">
        <label htmlFor="enemy-select" className="gm-dice-select-label">Inimigo Ativo:</label>
        <select
          id="enemy-select"
          value={selectedEnemyId}
          onChange={(e) => setSelectedEnemyId(e.target.value)}
          className="gm-dice-select"
        >
          {enemies.map((enemy) => (
            <option key={enemy.id} value={enemy.id}>
              {enemy.identity.name} ({enemy.identity.archetype}) — {threatLevelLabels[enemy.identity.threatLevel]}
            </option>
          ))}
        </select>
      </div>

      {selectedEnemy && (
        <div className="gm-dice-enemy-summary">
          <div className="gm-dice-stat">
            <span className="gm-dice-stat-label">HP</span>
            <span className="gm-dice-stat-value">{selectedEnemy.combat.hp.current} / {selectedEnemy.combat.hp.max}</span>
          </div>
          <div className="gm-dice-stat">
            <span className="gm-dice-stat-label">Armadura</span>
            <span className="gm-dice-stat-value">C {selectedEnemy.combat.armor.body} / H {selectedEnemy.combat.armor.head}</span>
          </div>
          <div className="gm-dice-stat">
            <span className="gm-dice-stat-label">Ameaça</span>
            <span className="gm-dice-stat-value gm-threat-badge" style={{ backgroundColor: threatLevelColors[selectedEnemy.identity.threatLevel] }}>
              {threatLevelLabels[selectedEnemy.identity.threatLevel]}
            </span>
          </div>
        </div>
      )}

      {/* Global Modifier */}
      <div className="gm-dice-global-modifier">
        <label>
          Modificador Global de Ataque:
          <input
            type="number"
            value={attackModifier}
            onChange={(e) => setAttackModifier(Number(e.target.value))}
            min="-20"
            max="20"
            step="1"
            className="gm-dice-modifier-input"
          />
        </label>
      </div>

      <div className="gm-dice-grid">
        {/* Attacks Section */}
        <section className="gm-dice-section">
          <h3>🎯 Ataques</h3>
          {attacks.length === 0 ? (
            <p className="gm-empty-state">Nenhum ataque disponível. Adicione armas ao inimigo.</p>
          ) : (
            <div className="gm-attacks-grid">
              {attacks.map((attack) => (
                <button
                  key={attack.id}
                  className={`gm-attack-button ${selectedAttackId === attack.id ? "gm-attack-button-selected" : ""}`}
                  onClick={() => {
                    setSelectedAttackId(attack.id);
                    handleRollAttack(attack.id);
                  }}
                >
                  <strong>{attack.label}</strong>
                  <span>{attack.detail}</span>
                </button>
              ))}
            </div>
          )}

          {lastAttackResult && (
            <AttackResultDisplay result={lastAttackResult} onRollDamage={handleRollDamage} />
          )}

          {lastDamageResult && (
            <DamageResultDisplay result={lastDamageResult} />
          )}
        </section>

        {/* Skill Checks Section */}
        <section className="gm-dice-section">
          <h3>🎲 Testes de Perícia</h3>
          <div className="gm-skill-selector">
            <select
              value={selectedSkillId}
              onChange={(e) => setSelectedSkillId(e.target.value)}
              className="gm-dice-select"
            >
              <option value="">Selecione uma perícia</option>
              {skills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name} ({skill.stat} {skill.base})
                </option>
              ))}
            </select>
            <div className="gm-skill-modifiers">
              <label>
                Mod:
                <input
                  type="number"
                  value={skillModifier}
                  onChange={(e) => setSkillModifier(Number(e.target.value))}
                  min="-20"
                  max="20"
                  step="1"
                  className="gm-dice-modifier-input gm-dice-modifier-small"
                />
              </label>
              <label>
                DV:
                <input
                  type="number"
                  value={skillTargetNumber}
                  onChange={(e) => setSkillTargetNumber(e.target.value)}
                  min="0"
                  max="30"
                  step="1"
                  className="gm-dice-modifier-input gm-dice-modifier-small"
                  placeholder="Opcional"
                />
              </label>
              <button className="gm-button gm-button-primary" onClick={handleRollSkill} disabled={!selectedSkillId}>
                Rolar
              </button>
            </div>
          </div>

          {lastSkillResult && (
            <SkillResultDisplay result={lastSkillResult} />
          )}
        </section>

        {/* Direct Damage Section */}
        <section className="gm-dice-section">
          <h3>💥 Dano Direto</h3>
          <p className="gm-dice-hint">Role dano sem fazer um ataque primeiro</p>
          <div className="gm-direct-damage">
            <input
              type="text"
              value={directDamageDice}
              onChange={(e) => setDirectDamageDice(e.target.value)}
              placeholder="Ex: 4d6, 2d6+3, 1d10+5, 3d6+2d10"
              className="gm-direct-damage-input"
            />
            <button className="gm-button gm-button-secondary" onClick={handleRollDirectDamage}>
              Rolar Dano
            </button>
          </div>

          {lastDirectDamage && (
            <DamageResultDisplay result={lastDirectDamage} />
          )}
        </section>
      </div>
    </div>
  );
}

function AttackResultDisplay({ result, onRollDamage }: { result: EnemyAttackRollResult; onRollDamage: () => void }) {
  return (
    <div className="gm-roll-result gm-attack-result">
      <div className="gm-roll-header">
        <h4>
          {result.label}
          {result.critical && <span className="gm-crit-badge">⚡ CRÍTICO</span>}
          {result.fumble && <span className="gm-fumble-badge">💥 FALHA CRÍTICA</span>}
          {!result.critical && !result.fumble && <span className="gm-total-badge">Total: {result.total}</span>}
        </h4>
      </div>
      <div className="gm-roll-formula">
        {result.stat.id} {result.stat.value} + {result.skill.name} {result.skill.value} + 1d10
      </div>
      <div className="gm-roll-dice">
        {result.diceRolls.map((r: { value: number; type: string }, idx: number) => (
          <span key={idx} className={`gm-die gm-die-${r.type}`}>[{r.value}]</span>
        ))}
      </div>
      {result.modifiers.length > 0 && (
        <div className="gm-roll-modifiers">
          {result.modifiers.map((m) => (
            <span key={m.source} className="gm-modifier">{m.source} {m.value >= 0 ? "+" : ""}{m.value}</span>
          ))}
        </div>
      )}
      <div className="gm-roll-total">= <strong>{result.total}</strong></div>

      {result.damageDice && (
        <button className="gm-button gm-button-primary gm-button-small" onClick={onRollDamage}>
          🎲 Rolar Dano ({result.damageDice})
        </button>
      )}
    </div>
  );
}

function DamageResultDisplay({ result }: { result: EnemyDamageRollResult }) {
  return (
    <div className="gm-roll-result gm-damage-result">
      <h4>Dano: {result.attackName}</h4>
      <div className="gm-roll-formula">{result.damageDice}</div>
      <div className="gm-roll-dice">
        {result.roll.rolls.map((r: number, idx: number) => (
          <span key={idx} className="gm-die">[{r}]</span>
        ))}
      </div>
      <div className="gm-roll-total">= <strong>{result.total}</strong></div>
      {result.roll.rolls.filter((r: number) => r === 6).length >= 2 && (
        <div className="gm-critical-injury-warning">⚠ CRITICAL INJURY! Dois ou mais resultados 6 nos dados de dano.</div>
      )}
    </div>
  );
}

function SkillResultDisplay({ result }: { result: EnemySkillCheckResult }) {
  return (
    <div className="gm-roll-result gm-skill-result">
      <div className="gm-roll-header">
        <h4>
          {result.skillName}
          {result.critical && <span className="gm-crit-badge">⚡ CRÍTICO</span>}
          {result.fumble && <span className="gm-fumble-badge">💥 FALHA CRÍTICA</span>}
          {result.success !== undefined && (
            <span className={`gm-success-badge ${result.success ? "success" : "failure"}`}>
              {result.success ? "✓ SUCESSO" : "✗ FALHA"}
            </span>
          )}
        </h4>
      </div>
      <div className="gm-roll-formula">
        {result.statId} {result.statBase} + {result.skillName} {result.skillLevel} + 1d10
      </div>
      <div className="gm-roll-dice">
        {result.diceRolls.map((r: { value: number; type: string }, idx: number) => (
          <span key={idx} className={`gm-die gm-die-${r.type}`}>[{r.value}]</span>
        ))}
      </div>
      {result.totalModifier !== 0 && (
        <div className="gm-roll-modifiers">Modificador: {result.totalModifier >= 0 ? "+" : ""}{result.totalModifier}</div>
      )}
      <div className="gm-roll-total">= <strong>{result.total}</strong></div>
    </div>
  );
}

// Import threat level labels and colors
import { threatLevelLabels, threatLevelColors } from "@/data/enemies";