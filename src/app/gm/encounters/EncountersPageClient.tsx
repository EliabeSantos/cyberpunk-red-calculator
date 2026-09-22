"use client";

import { useState, useEffect } from "react";
import {
  saveEncounter,
  loadEncounters,
  deleteEncounter,
  getEncounter,
  createEncounterFromFaction,
  updateParticipantHP,
  rollAttack,
  rollDamage,
  applyDamageToParticipant,
  addParticipantCondition,
  removeParticipantCondition,
  clearEncounters,
  type EncounterData,
} from "@/lib/gmStorage";
import { gmEnemyCatalog, availableFactions } from "@/data/gm-enemies";
import { bodyCriticalInjuries, headCriticalInjuries } from "@/data/criticalInjuries";
import { rollDice } from "@/lib/dice";

export default function EncountersPageClient() {
  const [phase, setPhase] = useState<"setup" | "combat" | "saved">("setup");
  const [faction, setFaction] = useState("");
  const [enemyCount, setEnemyCount] = useState(1);
  const [encounterName, setEncounterName] = useState("");
  const [encounter, setEncounter] = useState<EncounterData | null>(null);
  const [savedEncounters, setSavedEncounters] = useState<EncounterData[]>([]);
  const [activeTab, setActiveTab] = useState<"new" | "list">("new");
  const [selectedParticipant, setSelectedParticipant] = useState<number | null>(null);
  const [damageValue, setDamageValue] = useState("");
  const [ignoreArmor, setIgnoreArmor] = useState(false);
  const [hitLocation, setHitLocation] = useState<"head" | "body">("body");
  const [conditionName, setConditionName] = useState("");
  const [showConfirmDelete, setShowConfirmDelete] = useState<string | null>(null);

  // Load saved encounters
  useEffect(() => {
    setSavedEncounters(loadEncounters());
  }, [phase]);

  const handleFactionChange = (f: string) => {
    setFaction(f);
    const count = Math.min(4, gmEnemyCatalog.filter((e) => e.identity.faction === f).length || 1);
    setEnemyCount(count);
  };

  const handleStartEncounter = () => {
    if (!faction || !encounterName.trim()) return;
    const newEncounter = createEncounterFromFaction(encounterName.trim(), faction, enemyCount, gmEnemyCatalog);
    if (newEncounter.participants.length === 0) return;
    setEncounter(newEncounter);
    setPhase("combat");
    setActiveTab("new");
    setSelectedParticipant(null);
    setDamageValue("");
    setConditionName("");
  };

  const handleLoadEncounter = (id: string) => {
    const loaded = getEncounter(id);
    if (loaded) {
      setEncounter(loaded);
      setPhase("combat");
      setActiveTab("list");
      setSelectedParticipant(null);
      setDamageValue("");
      setConditionName("");
    }
  };

  const handleSaveEncounter = () => {
    if (!encounter) return;
    saveEncounter(encounter);
    setSavedEncounters(loadEncounters());
  };

  const handleDeleteEncounter = (id: string) => {
    deleteEncounter(id);
    setSavedEncounters(loadEncounters());
    setShowConfirmDelete(null);
  };

  const handleClearAll = () => {
    clearEncounters();
    setSavedEncounters([]);
    setPhase("setup");
    setEncounter(null);
  };

  const handleHeal = (participantIndex: number) => {
    if (!encounter) return;
    const participant = encounter.participants[participantIndex];
    const newHP = participant.hp.current + 1;
    setEncounter(updateParticipantHP(encounter, participantIndex, Math.min(newHP, participant.hp.max)));
    setSelectedParticipant(participantIndex);
  };

  const handleRollAttack = (participantIndex: number) => {
    if (!encounter) return;
    setEncounter(rollAttack(encounter, participantIndex));
  };

  const handleRollDamage = (participantIndex: number) => {
    if (!encounter) return;
    setEncounter(rollDamage(encounter, participantIndex));
  };

  const handleApplyDamage = (participantIndex: number) => {
    if (!encounter || damageValue === "") return;
    const damage = parseInt(damageValue, 10);
    if (isNaN(damage) || damage <= 0) return;
    setEncounter(applyDamageToParticipant(encounter, participantIndex, damage, ignoreArmor, hitLocation));
    setDamageValue("");
    setSelectedParticipant(participantIndex);
  };

  const handleAddCondition = (participantIndex: number) => {
    if (!encounter || conditionName.trim() === "") return;
    setEncounter(addParticipantCondition(encounter, participantIndex, {
      id: crypto.randomUUID(),
      name: conditionName.trim(),
    }));
    setConditionName("");
    setSelectedParticipant(participantIndex);
  };

  const handleRemoveCondition = (participantIndex: number, conditionId: string) => {
    if (!encounter) return;
    setEncounter(removeParticipantCondition(encounter, participantIndex, conditionId));
  };

  const handleSelectParticipant = (index: number) => {
    setSelectedParticipant(selectedParticipant === index ? null : index);
    setDamageValue("");
    setIgnoreArmor(false);
    setHitLocation("body");
    setConditionName("");
  };

  const handleRollInitiative = () => {
    if (!encounter) return;
    const withInitiative = encounter.participants.map((p) => {
      const roll = rollDice("1d10").rolls[0];
      return { ...p, initiative: roll + p.refStat };
    });
    withInitiative.sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0));
    setEncounter({ ...encounter, participants: withInitiative });
  };

  const handleImportAllEnemies = () => {
    const { importCatalogEnemies } = require("@/lib/gmStorage");
    importCatalogEnemies();
  };

  return (
    <div className="gm-page">
      <header className="gm-page-header">
        <div>
          <h1 className="gm-page-title">Combate / Encontros</h1>
          <p className="gm-page-subtitle">Gerencie encontros de combate, acompanhe HP e condições</p>
        </div>
        <div className="gm-page-header-actions">
          {phase === "combat" && (
            <button className="gm-button gm-button-secondary" onClick={handleSaveEncounter}>
              💾 Salvar Encontro
            </button>
          )}
          {savedEncounters.length > 0 && phase === "combat" && (
            <button className="gm-button gm-button-secondary" onClick={() => setPhase("saved")}>
              📋 Encontros Salvos
            </button>
          )}
          {phase === "saved" && (
            <button className="gm-button gm-button-secondary" onClick={handleClearAll}>
              🗑️ Limpar Todos
            </button>
          )}
        </div>
      </header>

      {phase === "setup" && (
        <>
        <div className="encounter-setup">
          <div className="encounter-setup-panel">
            <h2 className="section-heading">
              <span>⚔️</span> Novo Encontro
            </h2>

            <div className="encounter-form-grid">
              <div className="gm-form-field">
                <label className="gm-form-label" htmlFor="encounter-name">Nome do Encontro</label>
                <input
                  id="encounter-name"
                  className="gm-form-input"
                  type="text"
                  placeholder="Ex: Ataque à Corp Zone"
                  value={encounterName}
                  onChange={(e) => setEncounterName(e.target.value)}
                />
              </div>

              <div className="gm-form-field">
                <label className="gm-form-label" htmlFor="encounter-faction">Facção</label>
                <select
                  id="encounter-faction"
                  className="gm-form-select"
                  value={faction}
                  onChange={(e) => handleFactionChange(e.target.value)}
                >
                  <option value="">— Selecione uma facção —</option>
                  {availableFactions.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>

              <div className="gm-form-field">
                <label className="gm-form-label" htmlFor="encounter-count">Quantidade de Inimigos</label>
                <input
                  id="encounter-count"
                  className="gm-form-input"
                  type="number"
                  min={1}
                  max={12}
                  value={enemyCount}
                  onChange={(e) => setEnemyCount(parseInt(e.target.value, 10) || 1)}
                />
                <small className="gm-form-hint">
                  Inimigos serão selecionados da facção escolhida (máximo 12)
                </small>
              </div>

              <div className="encounter-preview">
                <h3 className="section-heading">
                  <span>👥</span> Preview dos Participantes
                </h3>
                {faction ? (
                  <div className="encounter-participant-list">
                    {Array.from({ length: enemyCount }, (_, i) => {
                      const factionEnemies = gmEnemyCatalog.filter((e) => e.identity.faction === faction && e.identity.archetype);
                      const source = factionEnemies.length > 0 ? factionEnemies[i % factionEnemies.length] : null;
                      return source ? (
                        <div key={i} className="encounter-preview-item">
                          <span className="encounter-preview-name">
                            {source.identity.name || `${source.identity.archetype} #${i + 1}`}
                          </span>
                          <span className="encounter-preview-meta">
                            {source.identity.archetype} · Level {source.identity.threatLevel === "extreme" ? 4 : source.identity.threatLevel === "high" ? 3 : source.identity.threatLevel === "medium" ? 2 : 1} · HP {source.combat.hp.max}
                          </span>
                        </div>
                      ) : (
                        <div key={i} className="encounter-preview-item">
                          <span className="encounter-preview-name">{faction} #${i + 1}</span>
                          <span className="encounter-preview-meta">Inimigo genérico</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="encounter-empty">Selecione uma facção para ver o preview</p>
                )}
              </div>
            </div>

            <div className="encounter-actions">
              <button
                className="gm-button gm-button-primary"
                onClick={handleStartEncounter}
                disabled={!faction || !encounterName.trim()}
              >
                ⚔️ Iniciar Encontro
              </button>
              <button className="gm-button gm-button-secondary" onClick={handleImportAllEnemies}>
                📦 Importar Catálogo Completo
              </button>
            </div>
          </div>
        </div>

        {savedEncounters.length > 0 && (
          <div className="encounter-setup-saved">
            <h2 className="section-heading">
              <span>📋</span> Encontros Salvos
            </h2>
            <div className="encounter-saved-list">
              {savedEncounters.map((e) => (
                <div key={e.id} className="encounter-saved-card">
                  <div className="encounter-saved-info">
                    <span className="encounter-saved-name">{e.name}</span>
                    <span className="encounter-saved-meta">
                      {e.faction} · {e.participants.length} inimigos · {new Date(e.createdAt).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                  <div className="encounter-saved-actions">
                    <button className="gm-button gm-button-small" onClick={() => handleLoadEncounter(e.id)}>
                      ▶️ Carregar
                    </button>
                    {showConfirmDelete === e.id ? (
                      <>
                        <button className="gm-button gm-button-small gm-button-danger" onClick={() => handleDeleteEncounter(e.id)}>
                          Confirmar
                        </button>
                        <button className="gm-button gm-button-small" onClick={() => setShowConfirmDelete(null)}>
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button className="gm-button gm-button-small" onClick={() => setShowConfirmDelete(e.id)}>
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="encounter-saved-back">
              <button className="gm-button gm-button-secondary" onClick={handleClearAll}>
                🗑️ Limpar Todos
              </button>
            </div>
          </div>
        )}
        </>
      )}

      {phase === "combat" && encounter && (
        <div className="encounter-combat">
          <div className="encounter-combat-header">
            <div>
              <h2 className="encounter-title">{encounter.name}</h2>
              <p className="encounter-faction">Facção: {encounter.faction} · {encounter.participants.length} participantes</p>
            </div>
            <div className="encounter-combat-actions">
              <button className="gm-button gm-button-small" onClick={handleRollInitiative}>
                🎲 Iniciativa
              </button>
            </div>
          </div>

          <div className="encounter-participants">
            {encounter.participants.map((p, index) => {
              const isSelected = selectedParticipant === index;
              const isDown = p.hp.current <= 0;
              const hpPercent = (p.hp.current / p.hp.max) * 100;
              const hpColor = hpPercent > 50 ? "#2e7d32" : hpPercent > 25 ? "#f57f17" : "#c62828";
              return (
                <div
                  key={index}
                  className={`encounter-participant-card ${isSelected ? "encounter-participant-selected" : ""} ${isDown ? "encounter-participant-down" : ""}`}
                  onClick={() => handleSelectParticipant(index)}
                >
                  {/* ── Header ── */}
                  <div className="epc-header">
                    <div className="epc-header-left">
                      <span className="epc-name">{p.name || "Sem nome"}</span>
                      {p.initiative != null && (
                        <span className="epc-initiative">{p.initiative}</span>
                      )}
                    </div>
                    <span className="epc-archetype">{p.archetype}</span>
                  </div>

                  {/* ── Status ── */}
                  <div className="epc-section">
                    <div className="epc-hp-row">
                      <span className="epc-hp-label">HP</span>
                      <span className="epc-hp-value">{p.hp.current}<small> / {p.hp.max}</small></span>
                    </div>
                    <div className="epc-hp-bar">
                      <div
                        className="epc-hp-fill"
                        style={{ width: `${hpPercent}%`, backgroundColor: hpColor }}
                      />
                    </div>
                  </div>

                  {/* ── Combat Info ── */}
                  <div className="epc-section epc-combat-info">
                    <div className="epc-info-row">
                      <span className="epc-info-label">🛡️ Armadura</span>
                      <span className="epc-info-value">C {p.armor.body} · H {p.armor.head}</span>
                    </div>
                    <div className="epc-info-row">
                      <span className="epc-info-label">⚔️ Arma</span>
                      <span className="epc-info-value">{p.weaponName}</span>
                    </div>
                    <div className="epc-info-row">
                      <span className="epc-info-label">🎯 Base</span>
                      <span className="epc-info-value">{p.weaponSkillName} ({p.skillValue}) + REF {p.refStat} = <strong>{p.attackBase}</strong></span>
                    </div>
                  </div>

                  {/* ── Rolls ── */}
                  <div className="epc-section epc-rolls">
                    <div className="epc-roll-row">
                      <button
                        className="gm-button gm-button-small"
                        onClick={(e) => { e.stopPropagation(); handleRollAttack(index); }}
                      >
                        🎲 Atacar
                      </button>
                      {p.lastAttackRoll != null && (
                        <span className={`epc-roll-result ${p.lastAttackRoll.fumble ? "epc-roll-fumble" : p.lastAttackRoll.critical ? "epc-roll-crit" : ""}`}>
                          {p.lastAttackRoll.fumble && "💀 "}
                          {p.lastAttackRoll.critical && "⚡ "}
                          d10({p.lastAttackRoll.diceRolls.join(", ")}) + {p.attackBase} = <strong>{p.lastAttackRoll.total}</strong>
                        </span>
                      )}
                    </div>
                    <div className="epc-roll-row">
                      <button
                        className="gm-button gm-button-small"
                        onClick={(e) => { e.stopPropagation(); handleRollDamage(index); }}
                      >
                        🔥 Dano ({p.damageExpression})
                      </button>
                      {p.lastDamageRoll != null && (
                        <span className="epc-roll-result epc-damage-result">
                          {p.lastDamageRoll.rolls.join(" + ")} = <strong>{p.lastDamageRoll.total}</strong> dmg
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── Tags ── */}
                  {(p.conditions.length > 0 || (p.personalityTraits && p.personalityTraits.length > 0)) && (
                    <div className="epc-section epc-tags">
                      {p.personalityTraits && p.personalityTraits.length > 0 && (
                        <div className="epc-tag-group">
                          {p.personalityTraits.map((trait) => (
                            <span key={trait.id} className="epc-tag epc-tag-personality" title={trait.description}>
                              🎭 {trait.name}
                            </span>
                          ))}
                        </div>
                      )}
                      {p.conditions.length > 0 && (
                        <div className="epc-tag-group">
                          {p.conditions.map((c, ci) => (
                            <span key={ci} className="epc-tag epc-tag-condition">
                              {c.name}
                              <button
                                className="epc-tag-remove"
                                onClick={(e) => { e.stopPropagation(); handleRemoveCondition(index, c.id); }}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Selected Controls ── */}
                  {isSelected && (
                    <div className="epc-controls">
                      <div className="epc-controls-section">
                        <span className="epc-controls-label">Dano</span>
                        <div className="epc-controls-row">
                          <input
                            className="gm-form-input gm-form-input-small"
                            type="number"
                            min={0}
                            placeholder="Valor"
                            value={damageValue}
                            onChange={(e) => setDamageValue(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button className="gm-button gm-button-small" onClick={(e) => { e.stopPropagation(); handleApplyDamage(index); }}>
                            💥 Aplicar
                          </button>
                          <button className="gm-button gm-button-small" onClick={(e) => { e.stopPropagation(); handleHeal(index); }}>
                            ❤️ Curar
                          </button>
                        </div>
                      </div>

                      <div className="epc-controls-section">
                        <div className="epc-controls-label-row">
                          <span className="epc-controls-label">Local do Golpe</span>
                          <label className="epc-armor-ignore" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={ignoreArmor}
                              onChange={(e) => setIgnoreArmor(e.target.checked)}
                            />
                            <span className="epc-armor-ignore-text">Ignorar Armadura</span>
                          </label>
                        </div>
                        <div className="epc-zone-picker">
                          <button
                            className={`epc-zone ${hitLocation === "head" ? "epc-zone-active" : ""}`}
                            onClick={(e) => { e.stopPropagation(); setHitLocation("head"); }}
                          >
                            <span className="epc-zone-icon">🧠</span>
                            <span className="epc-zone-info">
                              <span className="epc-zone-name">Cabeça</span>
                              <span className="epc-zone-sp">SP {p.armor.head}</span>
                            </span>
                          </button>
                          <button
                            className={`epc-zone ${hitLocation === "body" ? "epc-zone-active" : ""}`}
                            onClick={(e) => { e.stopPropagation(); setHitLocation("body"); }}
                          >
                            <span className="epc-zone-icon">🫁</span>
                            <span className="epc-zone-info">
                              <span className="epc-zone-name">Corpo</span>
                              <span className="epc-zone-sp">SP {p.armor.body}</span>
                            </span>
                          </button>
                        </div>
                      </div>

                      <div className="epc-controls-section">
                        <span className="epc-controls-label">Condição / Ferimento</span>
                        <div className="epc-controls-row epc-condition-inputs">
                          <select
                            className="gm-form-select gm-form-select-small"
                            value={conditionName}
                            onChange={(e) => setConditionName(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="">— Ferimentos —</option>
                            <optgroup label={hitLocation === "head" ? "🧠 Cabeça" : "🫁 Corpo"}>
                              {(hitLocation === "head" ? headCriticalInjuries : bodyCriticalInjuries).map((inj) => (
                                <option key={inj.name} value={inj.name}>
                                  {inj.name}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                          <input
                            className="gm-form-input gm-form-input-small"
                            type="text"
                            placeholder="ou digite..."
                            value={conditionName}
                            onChange={(e) => setConditionName(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button className="gm-button gm-button-small" onClick={(e) => { e.stopPropagation(); handleAddCondition(index); }} disabled={!conditionName.trim()}>
                            ➕
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="encounter-summary">
            <h3>Resumo</h3>
            <div className="encounter-summary-stats">
              <span>Vivos: {encounter.participants.filter((p) => p.hp.current > 0).length}</span>
              <span>Derrubados: {encounter.participants.filter((p) => p.hp.current <= 0).length}</span>
              <span>Total HP: {encounter.participants.reduce((a, p) => a + p.hp.current, 0)}/{encounter.participants.reduce((a, p) => a + p.hp.max, 0)}</span>
            </div>
          </div>
        </div>
      )}

      {phase === "saved" && (
        <div className="encounter-saved">
          <h2 className="section-heading">
            <span>📋</span> Encontros Salvos
          </h2>
          {savedEncounters.length === 0 ? (
            <div className="encounter-empty">
              <p>Nenhum encontro salvo ainda.</p>
              <button className="gm-button gm-button-secondary" onClick={() => setPhase("setup")}>
                ← Voltar para Novo Encontro
              </button>
            </div>
          ) : (
            <div className="encounter-saved-list">
              {savedEncounters.map((e) => (
                <div key={e.id} className="encounter-saved-card">
                  <div className="encounter-saved-info">
                    <span className="encounter-saved-name">{e.name}</span>
                    <span className="encounter-saved-meta">
                      {e.faction} · {e.participants.length} inimigos · {new Date(e.createdAt).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                  <div className="encounter-saved-actions">
                    <button className="gm-button gm-button-small" onClick={() => handleLoadEncounter(e.id)}>
                      ▶️ Carregar
                    </button>
                    {showConfirmDelete === e.id ? (
                      <>
                        <button className="gm-button gm-button-small gm-button-danger" onClick={() => handleDeleteEncounter(e.id)}>
                          Confirmar
                        </button>
                        <button className="gm-button gm-button-small" onClick={() => setShowConfirmDelete(null)}>
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button className="gm-button gm-button-small" onClick={() => setShowConfirmDelete(e.id)}>
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="encounter-saved-back">
            <button className="gm-button gm-button-secondary" onClick={() => setPhase("setup")}>
              ← Voltar para Novo Encontro
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
