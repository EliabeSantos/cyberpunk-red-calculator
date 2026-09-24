"use client";

import { useState } from "react";
import Link from "next/link";
import EnemyList from "@/components/gm/EnemyList";
import type { Enemy } from "@/types/enemy";
import type { EnemyRollContext } from "@/lib/enemyRolls";

export default function EnemiesPageClient() {
  const [selectedEnemy, setSelectedEnemy] = useState<Enemy | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "detail" | "dice">("list");

  const handleEdit = (enemy: Enemy) => {
    // Navigate to edit page with enemy ID
    window.location.href = `/gm/create?id=${enemy.id}`;
  };

  const handleRollDice = (enemy: Enemy) => {
    setSelectedEnemy(enemy);
    setViewMode("dice");
  };

  const handleBackToList = () => {
    setSelectedEnemy(null);
    setViewMode("list");
  };

  return (
    <div className="gm-page">
      <header className="gm-page-header">
        <div className="gm-page-header-main">
          <h1 className="gm-page-title">Inimigos</h1>
          <p className="gm-page-subtitle">Gerencie NPCs e inimigos para seus encontros</p>
        </div>
        <Link href="/gm/create" className="gm-page-create-button">
          <span aria-hidden="true">+</span> Novo Inimigo
        </Link>
      </header>

      {viewMode === "list" && (
        <EnemyList onEdit={handleEdit} />
      )}

      {viewMode === "detail" && selectedEnemy && (
        <div className="gm-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Ficha de ${selectedEnemy.identity.name}`} onClick={handleBackToList}>
          <div className="gm-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="gm-modal-close" onClick={handleBackToList} aria-label="Fechar">×</button>
            <EnemyDetailView
              enemy={selectedEnemy}
              onClose={handleBackToList}
              onEdit={handleEdit}
              onRollDice={handleRollDice}
            />
          </div>
        </div>
      )}

      {viewMode === "dice" && selectedEnemy && (
        <EnemyDiceView
          enemy={selectedEnemy}
          onClose={handleBackToList}
        />
      )}
    </div>
  );
}

function EnemyDetailView({
  enemy,
  onClose,
  onEdit,
  onRollDice,
}: {
  enemy: Enemy;
  onClose: () => void;
  onEdit: (enemy: Enemy) => void;
  onRollDice: (enemy: Enemy) => void;
}) {
  return (
    <article className="enemy-detail">
      <div className="enemy-detail-header">
        <button className="enemy-detail-close" onClick={onClose} aria-label="Fechar detalhes">
          ← Voltar
        </button>
        <div className="enemy-detail-title">
          <h2>{enemy.identity.name || "Sem nome"}</h2>
          <div className="enemy-detail-badges">
            <span className="enemy-archetype-badge">{enemy.identity.archetype || "Sem arquétipo"}</span>
            <span className="enemy-threat-badge" style={{ backgroundColor: getThreatColor(enemy.identity.threatLevel) }}>
              {getThreatLabel(enemy.identity.threatLevel)}
            </span>
          </div>
        </div>
        <div className="enemy-detail-actions">
          <button className="gm-button gm-button-secondary" onClick={() => onRollDice(enemy)}>
            🎲 Rolar Dados
          </button>
          <button className="gm-button gm-button-primary" onClick={() => onEdit(enemy)}>
            ✏️ Editar
          </button>
        </div>
      </div>

      <div className="enemy-detail-content">
        <section className="enemy-detail-section">
          <h3>Identidade</h3>
          <dl className="enemy-detail-dl">
            <div><dt>Nome</dt><dd>{enemy.identity.name || "—"}</dd></div>
            <div><dt>Arquétipo</dt><dd>{enemy.identity.archetype || "—"}</dd></div>
            <div><dt>Nível de Ameaça</dt><dd>{getThreatLabel(enemy.identity.threatLevel)}</dd></div>
            {enemy.identity.description && (
              <div className="enemy-detail-full"><dt>Descrição</dt><dd>{enemy.identity.description}</dd></div>
            )}
          </dl>
        </section>

        <section className="enemy-detail-section">
          <h3>Atributos</h3>
          <div className="enemy-attributes-grid">
            {Object.entries(enemy.stats).map(([stat, value]) => (
              <div key={stat} className="enemy-attribute">
                <span className="enemy-attribute-label">{stat}</span>
                <span className="enemy-attribute-value">{value}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="enemy-detail-section">
          <h3>Combate</h3>
          <div className="enemy-combat-grid">
            <div className="enemy-combat-stat">
              <dt>HP</dt>
              <dd>{enemy.combat.hp.current} / {enemy.combat.hp.max}</dd>
            </div>
            <div className="enemy-combat-stat">
              <dt>Armadura (Cabeça)</dt>
              <dd>{enemy.combat.armor.head} SP</dd>
            </div>
            <div className="enemy-combat-stat">
              <dt>Armadura (Corpo)</dt>
              <dd>{enemy.combat.armor.body} SP</dd>
            </div>
          </div>

          {enemy.combat.criticalInjuries.length > 0 && (
            <div className="enemy-critical-injuries">
              <h4>Lesões Críticas</h4>
              <ul>
                {enemy.combat.criticalInjuries.map((injury, idx) => (
                  <li key={idx}>
                    <strong>{injury.name}</strong> ({injury.location}) — {injury.effect}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="enemy-detail-section">
          <h3>Perícias ({Object.keys(enemy.skills).length})</h3>
          {Object.keys(enemy.skills).length === 0 ? (
            <p className="enemy-empty">Nenhuma perícia definida</p>
          ) : (
            <ul className="enemy-skills-list">
              {Object.entries(enemy.skills).map(([id, skill]) => (
                <li key={id}>
                  <strong>{skill.name}</strong> — {skill.stat} {enemy.stats[skill.stat]} + {skill.level} = <strong>{enemy.stats[skill.stat] + skill.level}</strong>
                  {skill.specialization && <span> ({skill.specialization})</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="enemy-detail-section">
          <h3>Armas ({enemy.weapons.length})</h3>
          {enemy.weapons.length === 0 ? (
            <p className="enemy-empty">Nenhuma arma equipada</p>
          ) : (
            <ul className="enemy-weapons-list">
              {enemy.weapons.map((weapon) => (
                <li key={weapon.id}>
                  <strong>{weapon.name}</strong> — {weapon.damage} · {weapon.attackType}
                  <br />
                  <small>Perícia: {weapon.skill} {weapon.rateOfFire ? `· ROF ${weapon.rateOfFire}` : ""} {weapon.magazine ? `· Mag ${weapon.ammo ?? 0}/${weapon.magazine}` : ""}</small>
                </li>
              ))}
            </ul>
          )}
        </section>

        {enemy.conditions.length > 0 && (
          <section className="enemy-detail-section">
            <h3>Condições Ativas ({enemy.conditions.length})</h3>
            <ul className="enemy-conditions-list">
              {enemy.conditions.map((condition) => (
                <li key={condition.id}>
                  <strong>{condition.name}</strong>
                  {condition.description && <span> — {condition.description}</span>}
                  {condition.duration && <span> · {condition.duration} rodadas restantes</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {enemy.gmNotes && (
          <section className="enemy-detail-section enemy-gm-notes">
            <h3>Notas do GM</h3>
            <p>{enemy.gmNotes}</p>
          </section>
        )}
      </div>
    </article>
  );
}

function EnemyDiceView({
  enemy,
  onClose,
}: {
  enemy: Enemy;
  onClose: () => void;
}) {
  const [lastAttackResult, setLastAttackResult] = useState<any>(null);
  const [lastSkillResult, setLastSkillResult] = useState<any>(null);
  const [lastDamageResult, setLastDamageResult] = useState<any>(null);
  const [selectedSkill, setSelectedSkill] = useState<string>("");
  const [modifier, setModifier] = useState(0);

  // Import enemyRolls dynamically to avoid SSR issues
  const rollAttack = async (weaponId?: string) => {
    const { rollEnemyAttack, getAvailableEnemyAttacks } = await import("@/lib/enemyRolls");
    const attacks: Array<{ id: string; label: string; detail: string; context: EnemyRollContext }> = getAvailableEnemyAttacks(enemy);
    const attack = attacks.find((a) => a.id === weaponId) || attacks[0];
    if (!attack) return;
    
    const result = rollEnemyAttack(enemy, {
      ...attack.context,
      modifiers: modifier !== 0 ? [{ source: "Modificador GM", value: modifier }] : undefined,
    });
    
    if ("result" in result) {
      setLastAttackResult(result.result);
      setLastDamageResult(null);
    }
  };

  const rollSkill = async () => {
    if (!selectedSkill) return;
    const { rollEnemySkillCheck } = await import("@/lib/enemyRolls");
    const result = rollEnemySkillCheck(enemy, {
      type: "skill_check",
      enemyId: enemy.id,
      skillId: selectedSkill,
      modifiers: modifier !== 0 ? [{ source: "Modificador GM", value: modifier }] : undefined,
    });
    
    if ("result" in result) {
      setLastSkillResult(result.result);
    }
  };

  const rollDamage = async () => {
    if (!lastAttackResult?.damageDice) return;
    const { rollEnemyDamage } = await import("@/lib/enemyRolls");
    const result = rollEnemyDamage(enemy, lastAttackResult.damageDice, lastAttackResult.label, lastAttackResult.weaponId);
    
    if ("result" in result) {
      setLastDamageResult(result.result);
    }
  };

  const { getAvailableEnemyAttacks } = require("@/lib/enemyRolls");
  const attacks = getAvailableEnemyAttacks(enemy) as Array<{ id: string; label: string; detail: string }>;
  const skills = Object.entries(enemy.skills).map(([id, skill]) => ({
    id,
    name: skill.name,
    base: enemy.stats[skill.stat] + skill.level,
    stat: skill.stat,
  }));

  return (
    <article className="enemy-dice">
      <div className="enemy-dice-header">
        <button className="enemy-detail-close" onClick={onClose} aria-label="Fechar rolagem de dados">
          ← Voltar
        </button>
        <div>
          <h2>Rolagem de Dados — {enemy.identity.name}</h2>
          <p className="gm-page-subtitle">Role ataques, perícias e dano para este inimigo</p>
        </div>
      </div>

      <div className="enemy-dice-content">
        {/* Global Modifier */}
        <div className="enemy-dice-modifier">
          <label>
            Modificador Global:
            <input
              type="number"
              value={modifier}
              onChange={(e) => setModifier(Number(e.target.value))}
              min="-20"
              max="20"
              step="1"
            />
          </label>
        </div>

        {/* Attacks */}
        <section className="enemy-dice-section">
          <h3>🎯 Ataques</h3>
          <div className="enemy-attacks-grid">
            {attacks.map((attack) => (
              <button
                key={attack.id}
                className="enemy-attack-button"
                onClick={() => rollAttack(attack.id)}
              >
                <strong>{attack.label}</strong>
                <span>{attack.detail}</span>
              </button>
            ))}
          </div>

          {lastAttackResult && (
            <div className="enemy-roll-result enemy-attack-result">
              <div className="enemy-roll-header">
                <h4>{lastAttackResult.label} — {lastAttackResult.critical ? "⚡ CRÍTICO" : lastAttackResult.fumble ? "💥 FALHA CRÍTICA" : "Total: " + lastAttackResult.total}</h4>
              </div>
              <div className="enemy-roll-formula">
                {lastAttackResult.stat.id} {lastAttackResult.stat.value} + {lastAttackResult.skill.name} {lastAttackResult.skill.value} + 1d10
              </div>
              <div className="enemy-roll-dice">
                {lastAttackResult.diceRolls.map((r: any, idx: number) => (
                  <span key={idx} className={`enemy-die ${r.type}`}>[{r.value}]</span>
                ))}
              </div>
              {lastAttackResult.modifiers.length > 0 && (
                <div className="enemy-roll-modifiers">
                  {lastAttackResult.modifiers.map((m: any) => (
                    <span key={m.source}>{m.source} {m.value >= 0 ? "+" : ""}{m.value}</span>
                  ))}
                </div>
              )}
              <div className="enemy-roll-total">= <strong>{lastAttackResult.total}</strong></div>
              
              {lastAttackResult.damageDice && (
                <button className="gm-button gm-button-primary" onClick={rollDamage}>
                  🎲 Rolar Dano ({lastAttackResult.damageDice})
                </button>
              )}
            </div>
          )}

          {lastDamageResult && (
            <div className="enemy-roll-result enemy-damage-result">
              <h4>Dano: {lastDamageResult.attackName}</h4>
              <div className="enemy-roll-formula">{lastDamageResult.damageDice}</div>
              <div className="enemy-roll-dice">
                {lastDamageResult.roll.rolls.map((r: number, idx: number) => (
                  <span key={idx} className="enemy-die">[{r}]</span>
                ))}
              </div>
              <div className="enemy-roll-total">= <strong>{lastDamageResult.total}</strong></div>
            </div>
          )}
        </section>

        {/* Skill Checks */}
        <section className="enemy-dice-section">
          <h3>🎲 Testes de Perícia</h3>
          <div className="enemy-skills-select">
            <label>
              Perícia:
              <select
                value={selectedSkill}
                onChange={(e) => setSelectedSkill(e.target.value)}
              >
                <option value="">Selecione uma perícia</option>
                {skills.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name} ({skill.stat} {skill.base})
                  </option>
                ))}
              </select>
            </label>
            <button
              className="gm-button gm-button-primary"
              onClick={rollSkill}
              disabled={!selectedSkill}
            >
              Rolar
            </button>
          </div>

          {lastSkillResult && (
            <div className="enemy-roll-result enemy-skill-result">
              <div className="enemy-roll-header">
                <h4>
                  {lastSkillResult.skillName} — 
                  {lastSkillResult.critical ? "⚡ CRÍTICO" : lastSkillResult.fumble ? "💥 FALHA CRÍTICA" : "Total: " + lastSkillResult.total}
                  {lastSkillResult.success !== undefined && (
                    <span className={lastSkillResult.success ? "success" : "failure"}>
                      {lastSkillResult.success ? " ✓ SUCESSO" : " ✗ FALHA"}
                    </span>
                  )}
                </h4>
              </div>
              <div className="enemy-roll-formula">
                {lastSkillResult.statId} {lastSkillResult.statBase} + {lastSkillResult.skillName} {lastSkillResult.skillLevel} + 1d10
              </div>
              <div className="enemy-roll-dice">
                {lastSkillResult.diceRolls.map((r: any, idx: number) => (
                  <span key={idx} className={`enemy-die ${r.type}`}>[{r.value}]</span>
                ))}
              </div>
              {lastSkillResult.totalModifier !== 0 && (
                <div className="enemy-roll-modifiers">Modificador: {lastSkillResult.totalModifier >= 0 ? "+" : ""}{lastSkillResult.totalModifier}</div>
              )}
              <div className="enemy-roll-total">= <strong>{lastSkillResult.total}</strong></div>
            </div>
          )}
        </section>

        {/* Quick Damage Roll */}
        <section className="enemy-dice-section">
          <h3>💥 Dano Direto</h3>
          <p className="enemy-dice-hint">Role dano sem fazer um ataque primeiro</p>
          <div className="enemy-damage-direct">
            <input
              type="text"
              placeholder="Ex: 4d6, 2d6+3, 1d10+5"
              id="direct-damage"
              className="enemy-damage-input"
            />
            <button className="gm-button gm-button-secondary" onClick={() => {
              const input = document.getElementById("direct-damage") as HTMLInputElement;
              if (input?.value) {
                rollDirectDamage(input.value);
              }
            }}>
              Rolar
            </button>
          </div>
        </section>
      </div>
    </article>
  );
}

function getThreatLabel(level: string): string {
  const labels: Record<string, string> = {
    low: "Baixa",
    medium: "Média",
    high: "Alta",
    extreme: "Extrema",
  };
  return labels[level] || level;
}

function getThreatColor(level: string): string {
  const colors: Record<string, string> = {
    low: "#2e7d32",
    medium: "#f57f17",
    high: "#c62828",
    extreme: "#6a1b9a",
  };
  return colors[level] || "#666";
}

async function rollDirectDamage(damageDice: string) {
  const { rollEnemyDamage } = await import("@/lib/enemyRolls");
  // We need the enemy - this is a simplified version
  // In reality we'd need to pass the enemy from the parent
}