"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { upsertEnemy, getEnemy } from "@/lib/gmStorage";
import { createEmptyEnemy } from "@/types/enemy";
import { archetypeOptions, threatLevels, threatLevelLabels } from "@/data/enemies";
import { enemyStatNames } from "@/types/enemy";
import type { Enemy, EnemyWeapon, EnemySkill, EnemyCondition } from "@/types/enemy";

/** Common skill names used in the catalog, mapped to their primary stat. */
const commonSkillOptions: Record<string, string> = {
  "Evasion": "REF",
  "Handgun": "REF",
  "Shoulder Arms": "REF",
  "Brawling": "REF",
  "Melee Weapon": "REF",
  "Autofire": "REF",
  "Heavy Weapons": "REF",
  "Stealth": "REF",
  "Throwing Knife": "REF",
  "Drive Land Vehicle": "REF",
  "Perception": "INT",
  "Tactics": "INT",
  "Demolitions": "INT",
  "Athletics": "BODY",
  "Endurance": "BODY",
  "First Aid": "TECH",
  "Paramedic": "TECH",
  "Electronics/Security Tech": "TECH",
  "Basic Tech": "TECH",
  "Cybertech": "TECH",
};

/** Common weapon names with default stats. */
const commonWeaponOptions: Record<string, { damage: string; attackType: "melee" | "ranged" | "thrown"; skill: string; rateOfFire: number; ammo: number | null }> = {
  "Light Melee Weapon": { damage: "1d6", attackType: "melee", skill: "Melee Weapon", rateOfFire: 2, ammo: null },
  "Medium Melee Weapon": { damage: "2d6", attackType: "melee", skill: "Melee Weapon", rateOfFire: 2, ammo: null },
  "Heavy Melee Weapon": { damage: "3d6", attackType: "melee", skill: "Melee Weapon", rateOfFire: 2, ammo: null },
  "Very Heavy Melee Weapon": { damage: "4d6", attackType: "melee", skill: "Melee Weapon", rateOfFire: 1, ammo: null },
  "Brawling": { damage: "2d6", attackType: "melee", skill: "Brawling", rateOfFire: 2, ammo: null },
  "Medium Pistol": { damage: "2d6", attackType: "ranged", skill: "Handgun", rateOfFire: 2, ammo: 12 },
  "Heavy Pistol": { damage: "3d6", attackType: "ranged", skill: "Handgun", rateOfFire: 2, ammo: 8 },
  "Very Heavy Pistol": { damage: "4d6", attackType: "ranged", skill: "Handgun", rateOfFire: 1, ammo: 8 },
  "SMG": { damage: "2d6", attackType: "ranged", skill: "Autofire", rateOfFire: 1, ammo: 40 },
  "Shotgun": { damage: "5d6", attackType: "ranged", skill: "Shoulder Arms", rateOfFire: 1, ammo: 8 },
  "Assault Shotgun": { damage: "5d6", attackType: "ranged", skill: "Shoulder Arms", rateOfFire: 2, ammo: 10 },
  "Assault Rifle": { damage: "5d6", attackType: "ranged", skill: "Shoulder Arms", rateOfFire: 1, ammo: 25 },
  "Heavy Machine Gun": { damage: "6d6", attackType: "ranged", skill: "Heavy Weapons", rateOfFire: 1, ammo: 50 },
  "Grenade": { damage: "6d6", attackType: "thrown", skill: "Demolitions", rateOfFire: 1, ammo: 1 },
};

export default function CreateEnemyPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editingId = searchParams.get("id");
  const isEditing = !!editingId;

  const [enemy, setEnemy] = useState<Enemy>(() => {
    if (isEditing && editingId) {
      const existing = getEnemy(editingId);
      return existing || createEmptyEnemy();
    }
    return createEmptyEnemy();
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load enemy data when editing
  useEffect(() => {
    if (isEditing && editingId) {
      const existing = getEnemy(editingId);
      if (existing) {
        setEnemy(existing);
      } else {
        setError("Inimigo não encontrado");
      }
    }
  }, [editingId, isEditing]);

  const updateEnemy = useCallback(<T extends keyof Enemy>(field: T, value: Enemy[T]) => {
    setEnemy((prev) => ({ ...prev, [field]: value, updatedAt: new Date().toISOString() }));
  }, []);

  const updateIdentity = useCallback(<K extends keyof Enemy["identity"]>(field: K, value: Enemy["identity"][K]) => {
    setEnemy((prev) => ({
      ...prev,
      identity: { ...prev.identity, [field]: value },
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const updateStats = useCallback(<K extends keyof Enemy["stats"]>(field: K, value: number) => {
    setEnemy((prev) => ({
      ...prev,
      stats: { ...prev.stats, [field]: value },
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const updateCombat = useCallback(<K extends keyof Enemy["combat"]>(field: K, value: Enemy["combat"][K]) => {
    setEnemy((prev) => ({
      ...prev,
      combat: { ...prev.combat, [field]: value },
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  // Recalculate max HP when BODY or WILL changes
  useEffect(() => {
    const maxHP = enemy.stats.BODY + enemy.stats.WILL;
    if (enemy.combat.hp.max !== maxHP) {
      updateCombat("hp", { ...enemy.combat.hp, max: maxHP });
    }
  }, [enemy.stats.BODY, enemy.stats.WILL, enemy.combat.hp.max, updateCombat]);

  /** Calculate attackBase for a weapon based on its skill and the enemy's stats. */
  const calculateAttackBase = useCallback((skillName: string): number => {
    const statName = commonSkillOptions[skillName];
    if (!statName || !(statName in enemy.stats)) return 0;
    const stat = enemy.stats[statName as keyof Enemy["stats"]];
    // Find the enemy's skill entry to get the level
    const skillEntry = Object.values(enemy.skills).find((s) => s.name === skillName);
    const skillLevel = skillEntry?.level ?? 0;
    return stat + skillLevel;
  }, [enemy.stats, enemy.skills]);

  // Recalculate attackBase for all weapons when stats or skills change
  useEffect(() => {
    let changed = false;
    const updatedWeapons = enemy.weapons.map((w) => {
      const correctBase = calculateAttackBase(w.skill);
      if (w.attackBase !== correctBase) {
        changed = true;
        return { ...w, attackBase: correctBase };
      }
      return w;
    });
    if (changed) {
      setEnemy((prev) => ({ ...prev, weapons: updatedWeapons, updatedAt: new Date().toISOString() }));
    }
  }, [enemy.stats, enemy.skills, enemy.weapons, calculateAttackBase]);

  const handleSave = async () => {
    if (!enemy.identity.name.trim()) {
      setError("Nome é obrigatório");
      return;
    }
    if (!enemy.identity.archetype.trim()) {
      setError("Arquétipo é obrigatório");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      upsertEnemy(enemy);
      router.push("/gm");
    } catch (err) {
      setError("Erro ao salvar inimigo");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    router.push("/gm");
  };

  // Skills management
  const addSkill = (predefined?: { name: string; stat: string }) => {
    const name = predefined?.name ?? "";
    const stat = (predefined?.stat ?? "REF") as EnemySkill["stat"];
    const newSkill: EnemySkill = { name, stat, level: 1 };
    const id = predefined?.name || `skill_${Date.now()}`;
    setEnemy((prev) => ({
      ...prev,
      skills: { ...prev.skills, [id]: newSkill },
      updatedAt: new Date().toISOString(),
    }));
  };

  const updateSkill = (id: string, field: keyof EnemySkill, value: string | number) => {
    setEnemy((prev) => {
      const updatedSkills = {
        ...prev.skills,
        [id]: { ...prev.skills[id], [field]: value },
      };
      // If the name changed, also update the key
      if (field === "name" && typeof value === "string" && value !== id) {
        const { [id]: old, ...rest } = updatedSkills;
        rest[value] = { ...old, name: value };
        return { ...prev, skills: rest, updatedAt: new Date().toISOString() };
      }
      return { ...prev, skills: updatedSkills, updatedAt: new Date().toISOString() };
    });
  };

  const removeSkill = (id: string) => {
    setEnemy((prev) => {
      const { [id]: removed, ...rest } = prev.skills;
      return { ...prev, skills: rest, updatedAt: new Date().toISOString() };
    });
  };

  // Weapons management
  const addWeapon = (predefined?: string) => {
    const preset = predefined ? commonWeaponOptions[predefined] : undefined;
    const name = predefined ?? "";
    const newWeapon: EnemyWeapon = {
      id: `weapon_${Date.now()}`,
      name,
      damage: preset?.damage ?? "1d6",
      attackType: preset?.attackType ?? "melee",
      skill: preset?.skill ?? "brawling",
      attackBase: 0,
      rateOfFire: preset?.rateOfFire ?? 2,
      magazine: undefined,
      ammo: preset?.ammo ?? undefined,
    };
    // Auto-calculate attackBase if skill is known
    if (preset?.skill) {
      newWeapon.attackBase = calculateAttackBase(preset.skill);
    }
    setEnemy((prev) => ({
      ...prev,
      weapons: [...prev.weapons, newWeapon],
      updatedAt: new Date().toISOString(),
    }));
  };

  const updateWeapon = (id: string, field: keyof EnemyWeapon, value: string | number | undefined) => {
    setEnemy((prev) => ({
      ...prev,
      weapons: prev.weapons.map((w) => {
        if (w.id !== id) return w;
        const updated = { ...w, [field]: value };
        // Auto-recalculate attackBase when skill changes
        if (field === "skill" && typeof value === "string") {
          updated.attackBase = calculateAttackBase(value);
        }
        return updated;
      }),
      updatedAt: new Date().toISOString(),
    }));
  };

  const removeWeapon = (id: string) => {
    setEnemy((prev) => ({
      ...prev,
      weapons: prev.weapons.filter((w) => w.id !== id),
      updatedAt: new Date().toISOString(),
    }));
  };

  // Conditions management
  const addCondition = () => {
    const newCondition: EnemyCondition = {
      id: `condition_${Date.now()}`,
      name: "",
      duration: undefined,
    };
    setEnemy((prev) => ({
      ...prev,
      conditions: [...prev.conditions, newCondition],
      updatedAt: new Date().toISOString(),
    }));
  };

  const updateCondition = (id: string, field: keyof EnemyCondition, value: string | number | undefined) => {
    setEnemy((prev) => ({
      ...prev,
      conditions: prev.conditions.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
      updatedAt: new Date().toISOString(),
    }));
  };

  const removeCondition = (id: string) => {
    setEnemy((prev) => ({
      ...prev,
      conditions: prev.conditions.filter((c) => c.id !== id),
      updatedAt: new Date().toISOString(),
    }));
  };

  // Derived: list of skill names the enemy already has
  const existingSkillNames = useMemo(
    () => Object.values(enemy.skills).map((s) => s.name).filter(Boolean),
    [enemy.skills]
  );

  // Predefined skills not yet added
  const availablePredefinedSkills = useMemo(
    () => Object.entries(commonSkillOptions).filter(([name]) => !enemy.skills[name]),
    [enemy.skills]
  );

  return (
    <div className="gm-page gm-create-page">
      <header className="gm-page-header">
        <div>
          <h1 className="gm-page-title">{isEditing ? "Editar Inimigo" : "Criar Inimigo"}</h1>
          <p className="gm-page-subtitle">{isEditing ? "Modifique os dados do inimigo" : "Preencha as informações do novo inimigo"}</p>
        </div>
        <div className="gm-page-header-actions">
          <button className="gm-button gm-button-secondary" onClick={handleCancel}>
            Cancelar
          </button>
          <button className="gm-button gm-button-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : isEditing ? "Salvar Alterações" : "Criar Inimigo"}
          </button>
        </div>
      </header>

      {error && <div className="gm-error" role="alert">{error}</div>}

      <div className="gm-create-sections">
        {/* Identity */}
        <section className="gm-create-section">
          <h2 className="gm-create-section-title">👤 Identidade</h2>
          <div className="gm-form-grid">
            <div className="gm-form-field">
              <label htmlFor="enemy-name">Nome *</label>
              <input
                id="enemy-name"
                type="text"
                value={enemy.identity.name}
                onChange={(e) => updateIdentity("name", e.target.value)}
                placeholder="Ex: Ganger Veterano, Solo Corporativo, Cyberpsycho"
                required
              />
            </div>
            <div className="gm-form-field">
              <label htmlFor="enemy-archetype">Arquétipo *</label>
              <select
                id="enemy-archetype"
                value={enemy.identity.archetype}
                onChange={(e) => updateIdentity("archetype", e.target.value)}
                required
              >
                <option value="">Selecione um arquétipo</option>
                {archetypeOptions.map((archetype) => (
                  <option key={archetype} value={archetype}>{archetype}</option>
                ))}
              </select>
            </div>
            <div className="gm-form-field">
              <label htmlFor="enemy-threat">Nível de Ameaça *</label>
              <select
                id="enemy-threat"
                value={enemy.identity.threatLevel}
                onChange={(e) => updateIdentity("threatLevel", e.target.value as "low" | "medium" | "high" | "extreme")}
                required
              >
                {threatLevels.map((level) => (
                  <option key={level} value={level}>
                    {threatLevelLabels[level]}
                  </option>
                ))}
              </select>
            </div>
            <div className="gm-form-field">
              <label htmlFor="enemy-faction">Facção</label>
              <input
                id="enemy-faction"
                type="text"
                value={enemy.identity.faction || ""}
                onChange={(e) => updateIdentity("faction", e.target.value)}
                placeholder="Ex: Arasaka, Militech, 6th Street, Maelstrom"
              />
            </div>
            <div className="gm-form-field">
              <label htmlFor="enemy-role">Função</label>
              <input
                id="enemy-role"
                type="text"
                value={enemy.identity.role || ""}
                onChange={(e) => updateIdentity("role", e.target.value)}
                placeholder="Ex: Ranged Mook, Elite Assault, Combat Medic"
              />
            </div>
            <div className="gm-form-field gm-form-field-full">
              <label htmlFor="enemy-description">Descrição</label>
              <textarea
                id="enemy-description"
                value={enemy.identity.description || ""}
                onChange={(e) => updateIdentity("description", e.target.value)}
                placeholder="Descrição visual, comportamento, táticas, etc."
                rows={4}
              />
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="gm-create-section">
          <h2 className="gm-create-section-title">📊 Atributos</h2>
          <div className="gm-form-grid gm-stats-grid">
            {enemyStatNames.map((stat) => (
              <div key={stat} className="gm-form-field gm-stat-field">
                <label htmlFor={`stat-${stat}`}>{stat}</label>
                <input
                  id={`stat-${stat}`}
                  type="number"
                  min="1"
                  max="12"
                  value={enemy.stats[stat]}
                  onChange={(e) => updateStats(stat, Number(e.target.value) || 1)}
                  className="gm-stat-input"
                />
              </div>
            ))}
          </div>
          <div className="gm-stats-summary">
            <strong>HP Máximo Calculado: </strong>
            <span className="gm-hp-value">{enemy.stats.BODY + enemy.stats.WILL}</span>
            <small>(BODY {enemy.stats.BODY} + WILL {enemy.stats.WILL})</small>
          </div>
        </section>

        {/* Skills */}
        <section className="gm-create-section">
          <h2 className="gm-create-section-title">🎯 Perícias</h2>
          <div className="gm-skills-header">
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <select
                className="gm-form-select-small"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    const [name, stat] = e.target.value.split("|");
                    addSkill({ name, stat });
                    e.target.value = "";
                  }
                }}
                aria-label="Adicionar perícia comum"
              >
                <option value="">+ Perícia rápida</option>
                {availablePredefinedSkills.map(([name, stat]) => (
                  <option key={name} value={`${name}|${stat}`}>{name} ({stat})</option>
                ))}
              </select>
              <button className="gm-button gm-button-secondary gm-button-small" onClick={() => addSkill()}>
                + Personalizada
              </button>
            </div>
          </div>
          {Object.keys(enemy.skills).length === 0 ? (
            <p className="gm-empty-state">Nenhuma perícia adicionada. Use "Perícia rápida" para adicionar uma perícia comum ou "Personalizada" para criar uma nova.</p>
          ) : (
            <div className="gm-skills-list">
              {Object.entries(enemy.skills).map(([id, skill]) => (
                <div key={id} className="gm-skill-row">
                  <div className="gm-skill-fields">
                    <div className="gm-form-field gm-skill-field">
                      <label>Nome</label>
                      <input
                        type="text"
                        value={skill.name}
                        onChange={(e) => updateSkill(id, "name", e.target.value)}
                        placeholder="Ex: Handgun, Brawling, Stealth"
                      />
                    </div>
                    <div className="gm-form-field gm-skill-field">
                      <label>Atributo</label>
                      <select
                        value={skill.stat}
                        onChange={(e) => updateSkill(id, "stat", e.target.value as Enemy["stats"] extends Record<infer K, any> ? K : never)}
                      >
                        {enemyStatNames.map((stat) => (
                          <option key={stat} value={stat}>{stat}</option>
                        ))}
                      </select>
                    </div>
                    <div className="gm-form-field gm-skill-field">
                      <label>Nível</label>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={skill.level}
                        onChange={(e) => updateSkill(id, "level", Number(e.target.value) || 0)}
                      />
                    </div>
                    <div className="gm-form-field gm-skill-field">
                      <label>Especialização (opcional)</label>
                      <input
                        type="text"
                        value={skill.specialization || ""}
                        onChange={(e) => updateSkill(id, "specialization", e.target.value)}
                        placeholder="Ex: Pistols, Katanas"
                      />
                    </div>
                  </div>
                  <div className="gm-skill-base">
                    Base: <strong>{enemy.stats[skill.stat] + skill.level}</strong> ({skill.stat} {enemy.stats[skill.stat]} + Nível {skill.level})
                  </div>
                  <button
                    className="gm-button gm-button-danger gm-button-small"
                    onClick={() => removeSkill(id)}
                    aria-label={`Remover perícia ${skill.name}`}
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Weapons */}
        <section className="gm-create-section">
          <h2 className="gm-create-section-title">⚔️ Armas</h2>
          <div className="gm-skills-header">
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <select
                className="gm-form-select-small"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    addWeapon(e.target.value);
                    e.target.value = "";
                  }
                }}
                aria-label="Adicionar arma comum"
              >
                <option value="">+ Arma rápida</option>
                {Object.keys(commonWeaponOptions).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <button className="gm-button gm-button-secondary gm-button-small" onClick={() => addWeapon()}>
                + Personalizada
              </button>
            </div>
          </div>
          {enemy.weapons.length === 0 ? (
            <p className="gm-empty-state">Nenhuma arma adicionada. Inimigos sempre podem atacar desarmados (Brawling).</p>
          ) : (
            <div className="gm-weapons-list">
              {enemy.weapons.map((weapon) => (
                <div key={weapon.id} className="gm-weapon-row">
                  <div className="gm-weapon-fields">
                    <div className="gm-form-field">
                      <label>Nome</label>
                      <input
                        type="text"
                        value={weapon.name}
                        onChange={(e) => updateWeapon(weapon.id, "name", e.target.value)}
                        placeholder="Ex: Heavy Pistol, Katana, Assault Rifle"
                      />
                    </div>
                    <div className="gm-form-field">
                      <label>Dano</label>
                      <input
                        type="text"
                        value={weapon.damage}
                        onChange={(e) => updateWeapon(weapon.id, "damage", e.target.value)}
                        placeholder="Ex: 2d6, 3d6+2, 4d6"
                      />
                    </div>
                    <div className="gm-form-field">
                      <label>Tipo</label>
                      <select
                        value={weapon.attackType}
                        onChange={(e) => updateWeapon(weapon.id, "attackType", e.target.value as EnemyWeapon["attackType"])}
                      >
                        <option value="melee">Corpo a corpo</option>
                        <option value="ranged">À distância</option>
                        <option value="thrown">Arremesso</option>
                      </select>
                    </div>
                    <div className="gm-form-field">
                      <label>Perícia</label>
                      {existingSkillNames.length > 0 ? (
                        <select
                          value={weapon.skill}
                          onChange={(e) => updateWeapon(weapon.id, "skill", e.target.value)}
                        >
                          <option value="">Selecione...</option>
                          {existingSkillNames.map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                          <option value="__custom">Outra (digitar)...</option>
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={weapon.skill}
                          onChange={(e) => updateWeapon(weapon.id, "skill", e.target.value)}
                          placeholder="Ex: handgun, brawling, rifle"
                        />
                      )}
                    </div>
                    {weapon.skill === "__custom" && (
                      <div className="gm-form-field">
                        <label>Nome da Perícia</label>
                        <input
                          type="text"
                          value=""
                          onChange={(e) => updateWeapon(weapon.id, "skill", e.target.value)}
                          placeholder="Digite o nome da perícia"
                          autoFocus
                        />
                      </div>
                    )}
                    <div className="gm-form-field">
                      <label>Base de Ataque</label>
                      <input
                        type="number"
                        min="0"
                        value={weapon.attackBase}
                        readOnly
                        className="gm-stat-input"
                        title="Calculado automaticamente (Atributo + Nível da Perícia)"
                      />
                      <small className="gm-hint">Auto-calculado</small>
                    </div>
                    <div className="gm-form-field">
                      <label>ROF</label>
                      <input
                        type="number"
                        min="0"
                        value={weapon.rateOfFire || 0}
                        onChange={(e) => updateWeapon(weapon.id, "rateOfFire", Number(e.target.value))}
                      />
                    </div>
                    <div className="gm-form-field">
                      <label>Carregador</label>
                      <input
                        type="number"
                        min="0"
                        value={weapon.magazine || ""}
                        onChange={(e) => updateWeapon(weapon.id, "magazine", e.target.value ? Number(e.target.value) : undefined)}
                        placeholder="-"
                      />
                    </div>
                    <div className="gm-form-field">
                      <label>Munição</label>
                      <input
                        type="number"
                        min="0"
                        value={weapon.ammo || ""}
                        onChange={(e) => updateWeapon(weapon.id, "ammo", e.target.value ? Number(e.target.value) : undefined)}
                        placeholder="-"
                      />
                    </div>
                  </div>
                  <button
                    className="gm-button gm-button-danger gm-button-small"
                    onClick={() => removeWeapon(weapon.id)}
                    aria-label={`Remover arma ${weapon.name}`}
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Combat */}
        <section className="gm-create-section">
          <h2 className="gm-create-section-title">❤️ Combate</h2>
          <div className="gm-form-grid gm-combat-grid">
            <div className="gm-form-field">
              <label htmlFor="enemy-hp-current">HP Atual</label>
              <input
                id="enemy-hp-current"
                type="number"
                min="0"
                max={enemy.combat.hp.max}
                value={enemy.combat.hp.current}
                onChange={(e) => updateCombat("hp", { ...enemy.combat.hp, current: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="gm-form-field">
              <label htmlFor="enemy-hp-max">HP Máximo</label>
              <input
                id="enemy-hp-max"
                type="number"
                min="1"
                value={enemy.combat.hp.max}
                onChange={(e) => updateCombat("hp", { ...enemy.combat.hp, max: Number(e.target.value) || 1 })}
                readOnly
              />
              <small className="gm-hint">Calculado automaticamente (BODY + WILL)</small>
            </div>
            <div className="gm-form-field">
              <label htmlFor="enemy-armor-head">Armadura - Cabeça (SP)</label>
              <input
                id="enemy-armor-head"
                type="number"
                min="0"
                max="50"
                value={enemy.combat.armor.head}
                onChange={(e) => updateCombat("armor", { ...enemy.combat.armor, head: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="gm-form-field">
              <label htmlFor="enemy-armor-body">Armadura - Corpo (SP)</label>
              <input
                id="enemy-armor-body"
                type="number"
                min="0"
                max="50"
                value={enemy.combat.armor.body}
                onChange={(e) => updateCombat("armor", { ...enemy.combat.armor, body: Number(e.target.value) || 0 })}
              />
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

        {/* Conditions */}
        <section className="gm-create-section">
          <h2 className="gm-create-section-title">🩹 Condições</h2>
          <div className="gm-skills-header">
            <button className="gm-button gm-button-secondary gm-button-small" onClick={addCondition}>
              + Adicionar Condição
            </button>
          </div>
          {enemy.conditions.length === 0 ? (
            <p className="gm-empty-state">Nenhuma condição ativa.</p>
          ) : (
            <div className="gm-conditions-list">
              {enemy.conditions.map((condition) => (
                <div key={condition.id} className="gm-condition-row">
                  <div className="gm-condition-fields">
                    <div className="gm-form-field">
                      <label>Nome</label>
                      <input
                        type="text"
                        value={condition.name}
                        onChange={(e) => updateCondition(condition.id, "name", e.target.value)}
                        placeholder="Ex: Envenenado, Atordoado, Em Chamas"
                      />
                    </div>
                    <div className="gm-form-field">
                      <label>Descrição</label>
                      <input
                        type="text"
                        value={condition.description || ""}
                        onChange={(e) => updateCondition(condition.id, "description", e.target.value)}
                        placeholder="Efeitos mecânicos, duração, etc."
                      />
                    </div>
                    <div className="gm-form-field">
                      <label>Duração (rodadas)</label>
                      <input
                        type="number"
                        min="0"
                        value={condition.duration || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateCondition(condition.id, "duration", val ? Number(val) : undefined);
                        }}
                        placeholder="Vazio = permanente"
                      />
                    </div>
                    <div className="gm-form-field">
                      <label>Origem</label>
                      <input
                        type="text"
                        value={condition.source || ""}
                        onChange={(e) => updateCondition(condition.id, "source", e.target.value)}
                        placeholder="O que causou esta condição"
                      />
                    </div>
                  </div>
                  <button
                    className="gm-button gm-button-danger gm-button-small"
                    onClick={() => removeCondition(condition.id)}
                    aria-label={`Remover condição ${condition.name}`}
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Notes */}
        <section className="gm-create-section">
          <h2 className="gm-create-section-title">📝 Notas GM</h2>
          <div className="gm-form-field gm-form-field-full">
            <label htmlFor="enemy-gm-notes">Notas do GM (apenas você vê)</label>
            <textarea
              id="enemy-gm-notes"
              value={enemy.gmNotes || ""}
              onChange={(e) => updateEnemy("gmNotes", e.target.value)}
              placeholder="Táticas, pontos fracos, loot, falas, segredos, etc."
              rows={10}
            />
          </div>
        </section>
      </div>

      {/* Mobile: as ações do cabeçalho saem da tela no primeiro scroll,
          então elas ganham uma barra fixa no rodapé. Só aparece ≤620px. */}
      <div className="gm-create-mobile-actions">
        <button className="gm-button gm-button-secondary" onClick={handleCancel}>
          Cancelar
        </button>
        <button className="gm-button gm-button-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Salvando..." : isEditing ? "Salvar Alterações" : "Criar Inimigo"}
        </button>
      </div>
    </div>
  );
}
