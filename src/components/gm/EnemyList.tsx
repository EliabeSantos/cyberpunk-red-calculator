"use client";

import { useState, useEffect, Fragment } from "react";
import type { Enemy } from "@/types/enemy";
import { loadEnemies, removeEnemy, importCatalogEnemies, upsertEnemy } from "@/lib/gmStorage";
import { threatLevelLabels, threatLevelColors } from "@/data/enemies";
import { gmEnemyCatalog, availableFactions, getEnemyById } from "@/data/gm-enemies";

interface EnemyListProps {
  onEdit?: (enemy: Enemy) => void;
  onView?: (enemy: Enemy) => void;
  onRollDice?: (enemy: Enemy) => void;
}

// Atributos exibidos no cartão (mesma ordem do texto original; LUCK fica de fora,
// como sempre esteve — igual ao formato antigo).
const CARD_STAT_ORDER = ["INT", "REF", "DEX", "TECH", "COOL", "WILL", "MOVE", "BODY", "EMP"] as const;

export default function EnemyList({ onEdit, onView, onRollDice }: EnemyListProps) {
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
        {enemies.map((enemy) => (
          <article
            key={enemy.id}
            className="enemy-card"
            data-threat-level={enemy.identity.threatLevel}
          >
            <div className="enemy-card-header">
              <div className="enemy-card-main">
                <h4 className="enemy-card-name">{enemy.identity.name || "Sem nome"}</h4>
                <div className="enemy-card-meta">
                  <span className="enemy-card-archetype">{enemy.identity.archetype || "Sem arquétipo"}</span>
                  <span className="enemy-card-threat" style={{ backgroundColor: threatLevelColors[enemy.identity.threatLevel], borderColor: threatLevelColors[enemy.identity.threatLevel] }}>
                    {threatLevelLabels[enemy.identity.threatLevel]}
                  </span>
                </div>
              </div>
              <div className="enemy-card-stats">
                <div className="enemy-stat">
                  <span className="enemy-stat-label">HP</span>
                  <span className="enemy-stat-value">{enemy.combat.hp.current}{" "}<small>/ {enemy.combat.hp.max}</small></span>
                </div>
                <div className="enemy-stat">
                  <span className="enemy-stat-label">Armadura</span>
                  <span className="enemy-stat-value">C {enemy.combat.armor.body}{" "}<small>H {enemy.combat.armor.head}</small></span>
                </div>
              </div>
            </div>

            {enemy.identity.description && (
              <p className="enemy-card-description">{enemy.identity.description}</p>
            )}

            <div className="enemy-card-preview">
              <div className="enemy-preview-item">
                <span className="enemy-preview-label">Atributos</span>
                <span className="enemy-preview-value">
                  {CARD_STAT_ORDER.map((stat, idx) => (
                    <Fragment key={stat}>
                      <span className="enemy-attr-token">
                        <span className="enemy-attr-label">{stat}</span>{" "}
                        <span className="enemy-attr-value">{enemy.stats[stat]}</span>
                      </span>
                      {idx < CARD_STAT_ORDER.length - 1 && (
                        <span className="enemy-attr-sep">{" · "}</span>
                      )}
                    </Fragment>
                  ))}
                </span>
              </div>
              <div className="enemy-preview-item">
                <span className="enemy-preview-label">Perícias</span>
                <span className="enemy-preview-value">
                  {Object.keys(enemy.skills).length} perícias
                </span>
              </div>
              <div className="enemy-preview-item">
                <span className="enemy-preview-label">Armas</span>
                <span className="enemy-preview-value">
                  {enemy.weapons.length} arma(s)
                </span>
              </div>
              {enemy.conditions.length > 0 && (
                <div className="enemy-preview-item enemy-preview-conditions">
                  <span className="enemy-preview-label">Condições</span>
                  <span className="enemy-preview-value">
                    {enemy.conditions.map((c) => c.name).join(", ")}
                  </span>
                </div>
              )}
            </div>

            <div className="enemy-card-actions">
              {onView && (
                <button
                  type="button"
                  className="enemy-action-button enemy-action-view"
                  onClick={() => onView(enemy)}
                  aria-label={`Visualizar ${enemy.identity.name}`}
                >
                  👁️ Ver
                </button>
              )}
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
              {onRollDice && (
                <button
                  type="button"
                  className="enemy-action-button enemy-action-roll"
                  onClick={() => onRollDice(enemy)}
                  aria-label={`Rolar dados para ${enemy.identity.name}`}
                >
                  🎲 Rolar
                </button>
              )}
              <button
                type="button"
                className="enemy-action-button enemy-action-duplicate"
                onClick={() => {
                  const duplicated: Enemy = {
                    ...enemy,
                    id: crypto.randomUUID(),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    identity: {
                      ...enemy.identity,
                      name: `${enemy.identity.name} (Cópia)`,
                    },
                  };
                  upsertEnemy(duplicated);
                  loadData();
                }}
                aria-label={`Duplicar ${enemy.identity.name}`}
                disabled={deletingId === enemy.id}
              >
                📋 Copiar
              </button>
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
        ))}
      </div>
    </div>
  );
}