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
import { notifyEnemyAttack, notifyEnemyDamage, notifyEnemyInitiative } from "@/lib/discord/rollNotify";

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
  const [minLevel, setMinLevel] = useState(1);
  const [maxLevel, setMaxLevel] = useState(4);
  const [previewSeed, setPreviewSeed] = useState(0);

  // Simple seeded random for stable preview picks
  const seededRandom = (seed: number) => {
    let s = seed;
    return () => {
      s = (s * 16807 + 0) % 2147483647;
      return (s - 1) / 2147483646;
    };
  };

  const getPreviewEnemies = (count: number) => {
    if (!faction) return [];
    const threatLevels = ["low", "medium", "high", "extreme"];
    const minThreat = threatLevels[minLevel - 1] || "low";
    const maxThreat = threatLevels[maxLevel - 1] || "extreme";
    const minIndex = threatLevels.indexOf(minThreat);
    const maxIndex = threatLevels.indexOf(maxThreat);
    const eligible = gmEnemyCatalog.filter(
      (e) => e.identity.faction === faction && e.identity.archetype && threatLevels.indexOf(e.identity.threatLevel) >= minIndex && threatLevels.indexOf(e.identity.threatLevel) <= maxIndex
    );
    if (eligible.length === 0) return [];
    const rng = seededRandom(previewSeed + count);
    const shuffled = [...eligible].sort(() => rng() - 0.5);
    // Wrap around if there are fewer eligible enemies than requested
    const result = [];
    for (let i = 0; i < count; i++) {
      result.push(shuffled[i % shuffled.length]);
    }
    return result;
  };

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
    const threatLevels = ["low", "medium", "high", "extreme"];
    const minThreat = threatLevels[minLevel - 1] || "low";
    const maxThreat = threatLevels[maxLevel - 1] || "extreme";
    const minIndex = threatLevels.indexOf(minThreat);
    const maxIndex = threatLevels.indexOf(maxThreat);
    const filteredCatalog = gmEnemyCatalog.filter(
      (e) => e.identity.faction === faction && threatLevels.indexOf(e.identity.threatLevel) >= minIndex && threatLevels.indexOf(e.identity.threatLevel) <= maxIndex
    );
    const newEncounter = createEncounterFromFaction(encounterName.trim(), faction, enemyCount, filteredCatalog.length > 0 ? filteredCatalog : gmEnemyCatalog);
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
    const next = rollAttack(encounter, participantIndex);
    setEncounter(next);
    // Espelho no Discord (mesmos portões do jogador): consentimento + mesa.
    notifyEnemyAttack(next.participants[participantIndex]);
  };

  const handleRollDamage = (participantIndex: number) => {
    if (!encounter) return;
    const next = rollDamage(encounter, participantIndex);
    setEncounter(next);
    notifyEnemyDamage(next.participants[participantIndex]);
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
    const rolled = encounter.participants.map((p) => {
      const roll = rollDice("1d10").rolls[0];
      return { participant: p, roll, ref: p.refStat, total: roll + p.refStat };
    });
    rolled.sort((a, b) => b.total - a.total);
    setEncounter({
      ...encounter,
      participants: rolled.map((r) => ({ ...r.participant, initiative: r.total })),
    });
    // UMA única mensagem-resumo com a tabela completa (uma por inimigo
    // encheria o canal e esbarraria no rate limit do Discord).
    notifyEnemyInitiative(
      encounter.name,
      rolled.map((r) => ({
        name: r.participant.name.trim() || r.participant.archetype.trim() || "Inimigo",
        roll: r.roll,
        ref: r.ref,
        total: r.total,
      })),
    );
  };

  return (
    <div className="gm-page gm-encounters-page">
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
              <div className="encounter-hero">
                <div className="encounter-hero-content">
                  <div className="encounter-hero-icon">⚔️</div>
                  <div className="encounter-hero-text">
                    <h2 className="encounter-hero-title">Novo Encontro</h2>
                    <p className="encounter-hero-desc">Configure o combate, selecione a facção inimiga e inicie a sessão de combate.</p>
                  </div>
                </div>
              </div>
              <div className="encounter-form-grid">
                <div className="encounter-form-section">
                  <div className="encounter-form-section-header">
                    <span className="encounter-form-section-icon">📝</span>
                    <span className="encounter-form-section-title">Identificação</span>
                  </div>
                  <div className="encounter-form-fields">
                    <div className="gm-form-field">
                      <label className="gm-form-label" htmlFor="encounter-name">
                        Nome do Encontro <span className="encounter-required">*</span>
                      </label>
                      <input
                        id="encounter-name"
                        className="gm-form-input"
                        type="text"
                        placeholder="Ex: Ataque à Corp Zone"
                        value={encounterName}
                        onChange={(e) => setEncounterName(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="encounter-form-section">
                  <div className="encounter-form-section-header">
                    <span className="encounter-form-section-icon">🛡️</span>
                    <span className="encounter-form-section-title">Forças Inimigas</span>
                  </div>
                  <div className="encounter-form-fields">
                    <div className="gm-form-field">
                      <label className="gm-form-label" htmlFor="encounter-faction">
                        Facção <span className="encounter-required">*</span>
                      </label>
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
                  </div>
                </div>

                <div className="encounter-preview">
                  <div className="encounter-preview-header">
                    <h3 className="section-heading">
                      <span>👥</span> Preview dos Participantes
                    </h3>
                    <div className="encounter-preview-controls">
                      <label className="encounter-minlevel-label">
                        Min Level
                        <select
                          className="encounter-minlevel-select"
                          value={minLevel}
                          onChange={(e) => { setMinLevel(Number(e.target.value)); setPreviewSeed((s) => s + 1); }}
                        >
                          <option value={1}>1</option>
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                          <option value={4}>4</option>
                        </select>
                      </label>
                      <label className="encounter-minlevel-label">
                        Max Level
                        <select
                          className="encounter-minlevel-select"
                          value={maxLevel}
                          onChange={(e) => { setMaxLevel(Number(e.target.value)); setPreviewSeed((s) => s + 1); }}
                        >
                          <option value={1}>1</option>
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                          <option value={4}>4</option>
                        </select>
                      </label>
                      <button
                        className="gm-button gm-button-small encounter-repick-button"
                        onClick={() => setPreviewSeed((s) => s + 1)}
                        disabled={!faction}
                      >
                        🔄 Repick
                      </button>
                    </div>
                  </div>
                  {faction ? (
                    <div className="encounter-participant-list">
                      {getPreviewEnemies(enemyCount).map((source, i) => (
                        <div key={`${previewSeed}-${i}`} className="encounter-preview-item">
                          <span className="encounter-preview-name">
                            {source.identity.name || `${source.identity.archetype} #${i + 1}`}
                          </span>
                          <span className="encounter-preview-meta">
                            {source.identity.archetype} · Level {source.identity.threatLevel === "extreme" ? 4 : source.identity.threatLevel === "high" ? 3 : source.identity.threatLevel === "medium" ? 2 : 1} · HP {source.combat.hp.max}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="encounter-empty">Selecione uma facção para ver o preview</p>
                  )}
                </div>
              </div>

              <div className="encounter-actions">
                <button
                  className="gm-button gm-button-primary encounter-start-button"
                  onClick={handleStartEncounter}
                  disabled={!faction || !encounterName.trim()}
                >
                  <span className="encounter-start-icon">⚔️</span>
                  <span className="encounter-start-text">Iniciar Encontro</span>
                </button>
              </div>

              {savedEncounters.length > 0 && (
                <div className="encounter-setup-saved">
                  <div className="encounter-saved-header">
                    <div className="encounter-saved-header-left">
                      <span className="encounter-saved-header-icon">📋</span>
                      <div>
                        <h2 className="encounter-saved-header-title">Encontros Salvos</h2>
                        <span className="encounter-saved-header-count">{savedEncounters.length} encontro{savedEncounters.length !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    <button className="gm-button gm-button-small gm-button-danger" onClick={handleClearAll}>
                      🗑️ Limpar Todos
                    </button>
                  </div>
                  <div className="encounter-saved-list">
                    {savedEncounters.map((e) => (
                      <div key={e.id} className="encounter-saved-card">
                        <div className="encounter-saved-card-main">
                          <span className="encounter-saved-name">{e.name}</span>
                          <div className="encounter-saved-details">
                            <span className="encounter-saved-detail-badge">{e.faction}</span>
                            <span className="encounter-saved-detail-text">{e.participants.length} inimigos</span>
                            <span className="encounter-saved-detail-sep">·</span>
                            <span className="encounter-saved-detail-text">{new Date(e.createdAt).toLocaleDateString("pt-BR")}</span>
                          </div>
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
                </div>
              )}
            </div>
          </div>
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
