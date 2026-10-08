"use client";

import { useState, useEffect } from "react";
import type { Enemy } from "@/types/enemy";
import { loadEnemies, removeEnemy, importCatalogEnemies } from "@/lib/gmStorage";
import { threatLevelLabels } from "@/data/enemies";
import { gmEnemyCatalog } from "@/data/gm-enemies";

interface EnemyListProps {
  onEdit?: (enemy: Enemy) => void;
}

// Atributos exibidos no cartão (mesma ordem do texto original; LUCK fica de fora,
// como sempre esteve — igual ao formato antigo).
const CARD_STAT_ORDER = ["INT", "REF", "DEX", "TECH", "COOL", "WILL", "MOVE", "BODY", "EMP"] as const;

export default function EnemyList({ onEdit }: EnemyListProps) {
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const loadData = () => {
    setLoading(true);
    const data = loadEnemies();
    setEnemies(data);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDelete = (enemyId: string) => {
    if (!confirm("Tem certeza que deseja excluir este inimigo? Esta ação não pode ser desfeita.")) return;
    setDeletingId(enemyId);
    removeEnemy(enemyId);
    setEnemies((prev) => prev.filter((e) => e.id !== enemyId));
    setDeletingId(null);
  };

  const handleImportCatalog = async () => {
    setImporting(true);
    try {
      const imported = importCatalogEnemies();
      setEnemies(imported);
    } catch (err) {
      console.error("Erro ao importar catálogo:", err);
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="enemy-list-loading" role="status" aria-label="Carregando inimigos">
        <div className="gm-access-spinner" aria-hidden="true"></div>
        <p>Carregando inimigos...</p>
      </div>
    );
  }

  if (enemies.length === 0 && !importing) {
    return (
      <div className="enemy-list-empty">
        <div className="enemy-list-empty-icon" aria-hidden="true">👥</div>
        <h3>Nenhum inimigo cadastrado</h3>
        <p>O catálogo contém {gmEnemyCatalog.length} inimigos prontos.</p>
        <button className="enemy-list-import-button" onClick={handleImportCatalog} disabled={importing}>
          {importing ? "Importando..." : `📋 Importar Catálogo (${gmEnemyCatalog.length} Inimigos)`}
        </button>
        <p className="enemy-list-divider">ou</p>
        <a href="/gm/create" className="enemy-list-create-link">
          <span>+</span> Criar Inimigo Manualmente
        </a>
      </div>
    );
  }

  return (
    <div className="enemy-list-container">
      <div className="enemy-list-toolbar">
        <span className="enemy-list-count">{enemies.length} inimigo(s)</span>
        <button
          className="enemy-action-button enemy-action-import"
          onClick={handleImportCatalog}
          disabled={importing}
        >
          {importing ? "⏳ Importando..." : `📋 Importar Catálogo (${gmEnemyCatalog.length})`}
        </button>
      </div>
      <div className="enemy-list" role="list" aria-label="Lista de inimigos">
        {enemies.map((enemy, index) => {
          const hpPercent = enemy.combat.hp.max > 0
            ? Math.max(0, Math.min(100, (enemy.combat.hp.current / enemy.combat.hp.max) * 100))
            : 0;
          const hpStatus = enemy.combat.hp.current <= 0
            ? "Derrotado"
            : hpPercent <= 25
              ? "Crítico"
              : "Operacional";
          const hpTone = enemy.combat.hp.current <= 0 ? "dead" : hpPercent <= 25 ? "critical" : "normal";

          return (
          <article
            key={enemy.id}
            className="enemy-card"
            data-threat-level={enemy.identity.threatLevel}
          >
            <div className="enemy-card-console-line" aria-hidden="true">
              <span>NPC // {String(index + 1).padStart(2, "0")}</span>
              <span>{enemy.identity.faction || "ROSTER LOCAL"}</span>
              <i />
            </div>

            <header className="enemy-card-header">
              <div className="enemy-card-main">
                <span className="enemy-card-kicker">Perfil de ameaça</span>
                <h4 className="enemy-card-name">{enemy.identity.name || "Sem nome"}</h4>
                <div className="enemy-card-meta">
                  <span className="enemy-card-archetype">{enemy.identity.archetype || "Sem arquétipo"}</span>
                  {enemy.identity.role && <span className="enemy-card-role">{enemy.identity.role}</span>}
                </div>
              </div>
              <div className="enemy-card-threat-box">
                <span className="enemy-card-threat-label">Ameaça</span>
                <span className="enemy-card-threat">{threatLevelLabels[enemy.identity.threatLevel]}</span>
              </div>
            </header>

            <section className="enemy-card-vitals" aria-label={`Status de ${enemy.identity.name || "inimigo"}`}>
              <div className="enemy-card-hp-block">
                <div className="enemy-card-hp-values">
                  <span className="enemy-card-vital-label">HP</span>
                  <strong>{enemy.combat.hp.current}</strong>
                  <span>/ {enemy.combat.hp.max}</span>
                  <em className={`enemy-card-hp-status hp-${hpTone}`}>{hpStatus}</em>
                </div>
                <div className="enemy-card-hp-bar" role="progressbar" aria-label="HP" aria-valuenow={enemy.combat.hp.current} aria-valuemin={0} aria-valuemax={enemy.combat.hp.max}>
                  <i className={`hp-${hpTone}`} style={{ width: `${hpPercent}%` }} />
                </div>
              </div>
              <div className="enemy-card-armor-block">
                <span className="enemy-card-vital-label">Armadura</span>
                <strong>C {enemy.combat.armor.body}</strong>
                <span>H {enemy.combat.armor.head}</span>
              </div>
            </section>

            {enemy.identity.description && (
              <p className="enemy-card-description">{enemy.identity.description}</p>
            )}

            <section className="enemy-card-systems" aria-label="Sistemas do inimigo">
              <div className="enemy-card-section-heading">
                <span className="enemy-card-kicker">Leitura tática</span>
                <strong>Atributos</strong>
              </div>
              <div className="enemy-card-stat-grid">
                {CARD_STAT_ORDER.map((stat) => (
                  <div key={stat} className="enemy-card-stat-cell">
                    <span>{stat}</span>
                    <strong>{enemy.stats[stat]}</strong>
                  </div>
                ))}
              </div>
            </section>

            <div className="enemy-card-loadout">
              <div className="enemy-card-loadout-item">
                <span>Perícias</span>
                <strong>{Object.keys(enemy.skills).length}</strong>
              </div>
              <div className="enemy-card-loadout-item">
                <span>Armas</span>
                <strong>{enemy.weapons.length}</strong>
              </div>
              {enemy.conditions.length > 0 && (
                <div className="enemy-card-loadout-item enemy-card-condition-item">
                  <span>Condições</span>
                  <strong>{enemy.conditions.length}</strong>
                  <small title={enemy.conditions.map((condition) => condition.name).join(", ")}>
                    {enemy.conditions.map((condition) => condition.name).join(", ")}
                  </small>
                </div>
              )}
            </div>

            <div className="enemy-card-actions">
              {onEdit && (
                <button
                  type="button"
                  className="enemy-action-button enemy-action-edit"
                  onClick={() => onEdit(enemy)}
                  aria-label={`Editar ${enemy.identity.name}`}
                >
                  ✏️ Editar
                </button>
              )}
              <button
                type="button"
                className="enemy-action-button enemy-action-delete"
                onClick={() => handleDelete(enemy.id)}
                aria-label={`Excluir ${enemy.identity.name}`}
                disabled={deletingId === enemy.id}
              >
                🗑️ Excluir
              </button>
            </div>
          </article>
          );
        })}
      </div>
    </div>
  );
}
