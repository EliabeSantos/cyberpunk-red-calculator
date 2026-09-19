"use client";

import { useState } from "react";

import {
  canUpgradeSkill,
  getSkillUpgradeCost,
  grantImprovementPoints,
  upgradeSkill,
} from "@/lib/progression";
import { equipInventoryItem, isEquippableItem } from "@/lib/inventory";
import { rollDamageForLastAttack } from "@/lib/damage";
import type { HumanityLossResult } from "@/lib/humanity";
import StorePanel from "@/components/sheets/StorePanel";
import AttackActions from "@/components/combat/AttackActions";
import type { AttackRollResult, DamageRollResult } from "@/types/attack";
import type { AttributeName, Character } from "@/types/character";

type CharacterSheetProps = {
  character: Character;
  onUpdate: (character: Character) => void;
  onEdit: () => void;
  onNewCharacter: () => void;
};
const statOrder: AttributeName[] = [
  "INT",
  "REF",
  "DEX",
  "TECH",
  "COOL",
  "WILL",
  "LUCK",
  "MOVE",
  "BODY",
  "EMP",
];
const statNames: Record<AttributeName, string> = {
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
function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="sheet-empty">{children}</p>;
}

export default function CharacterSheet({
  character,
  onUpdate,
  onEdit,
  onNewCharacter,
}: CharacterSheetProps) {
  const [ipToGrant, setIpToGrant] = useState(0);
  const [lastHumanityLoss, setLastHumanityLoss] =
    useState<HumanityLossResult | null>(null);
  const [lastAttack, setLastAttack] = useState<AttackRollResult | null>(null);
  const [lastDamage, setLastDamage] = useState<DamageRollResult | null>(null);
  const skillsByStat = statOrder
    .map(
      (stat) =>
        [
          stat,
          Object.entries(character.skills).filter(
            ([, skill]) => skill.stat === stat,
          ),
        ] as const,
    )
    .filter(([, skills]) => skills.length > 0);
  const availableIP = character.progression?.improvementPoints ?? 0;
  function grantIP() {
    const updated = grantImprovementPoints(character, ipToGrant);
    if (updated !== character) {
      onUpdate(updated);
      setIpToGrant(0);
    }
  }
  function improveSkill(skillId: string) {
    const updated = upgradeSkill(character, skillId);
    if (updated) onUpdate(updated);
  }
  function rollDamage() {
    const resolution = rollDamageForLastAttack(character);
    if ("error" in resolution) return;
    onUpdate(resolution.character);
    setLastDamage(resolution.result);
  }
  function equipItem(inventoryItemId: string) {
    const result = equipInventoryItem(character, inventoryItemId);
    if (!result) return;
    onUpdate(result.character);
    setLastHumanityLoss(result.cyberwareInstallation?.humanityLoss ?? null);
  }
  return (
    <main className="sheet-shell">
      <nav className="sheet-nav">
        <span>CYBERPUNK RED TOOLKIT</span>
        <div>
          <button onClick={onEdit}>Editar ficha</button>
          <button className="nav-accent" onClick={onNewCharacter}>
            Novo personagem
          </button>
        </div>
      </nav>
      <header className="sheet-hero">
        <div className="sheet-photo">
          {character.identity.photoUrl ? (
            <img
              src={character.identity.photoUrl}
              alt={character.identity.name || "Personagem"}
            />
          ) : (
            <span>SEM FOTO</span>
          )}
        </div>
        <div>
          <p className="eyebrow">Ficha de personagem</p>
          <h1>{character.identity.name || "Sem nome"}</h1>
          <p className="role-line">
            {character.identity.role || "Sem Role"} <span>•</span> Nível{" "}
            {character.identity.level}
          </p>
          <p className="player-line">
            Jogador: {character.identity.player || "Não informado"}
          </p>
        </div>
        <div className="hero-vitals">
          <div>
            <small>HP</small>
            <strong>
              {character.combat.hp.current} <i>/</i> {character.combat.hp.max}
            </strong>
          </div>
          <div>
            <small>Humanidade</small>
            <strong>
              {character.humanity.current} <i>/</i> {character.humanity.max}
            </strong>
          </div>
          <div>
            <small>Armadura</small>
            <strong>
              C {character.combat.armor.body} <i>•</i> H{" "}
              {character.combat.armor.head}
            </strong>
          </div>
        </div>
      </header>
      {lastHumanityLoss && (
        <section className="humanity-result" role="status">
          <strong>{lastHumanityLoss.cyberwareName} instalado</strong>
          <span>Humanity Loss: {lastHumanityLoss.expression ?? "fixa"}</span>
          {lastHumanityLoss.rolls.length > 0 && (
            <span>
              Rolagens:{" "}
              {lastHumanityLoss.rolls.map((roll) => `[${roll}]`).join(" ")}
            </span>
          )}
          <b>
            Perda: {lastHumanityLoss.humanityLost} ·{" "}
            {lastHumanityLoss.humanityBefore} → {lastHumanityLoss.humanityAfter}{" "}
            Humanidade
          </b>
          <button type="button" onClick={() => setLastHumanityLoss(null)}>
            ×
          </button>
        </section>
      )}
      <section className="sheet-layout">
        <aside className="sheet-column">
          <section className="sheet-panel">
            <PanelTitle number="01">Atributos</PanelTitle>
            <div className="stats-list">
              {statOrder.map((stat) => (
                <div key={stat}>
                  <span>{stat}</span>
                  <small>{statNames[stat]}</small>
                  <strong>{character.stats[stat]}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="sheet-panel">
            <PanelTitle number="02">Combate</PanelTitle>
            <div className="combat-grid">
              <Metric
                label="HP"
                value={`${character.combat.hp.current} / ${character.combat.hp.max}`}
              />
              <Metric
                label="Stamina"
                value={`${character.combat.stamina.current} / ${character.combat.stamina.max}`}
              />
              <Metric
                label="Armadura cabeça"
                value={character.combat.armor.head}
              />
              <Metric
                label="Armadura corpo"
                value={character.combat.armor.body}
              />
              <Metric
                label="Sorte"
                value={`${character.luck.current} / ${character.luck.max}`}
              />
            </div>
            <h3>Ataques</h3>
            <AttackActions
              character={character}
              onUpdate={onUpdate}
              onResult={(result) => {
                setLastAttack(result);
                setLastDamage(null);
              }}
            />
            {(lastAttack ?? character.lastAttack) &&
              (() => {
                const attack = lastAttack ?? character.lastAttack!;
                return (
                  <div className="attack-result" role="status">
                    <strong>{attack.label}</strong>
                    <span>
                      1d10: [{attack.naturalRoll}] · {attack.stat.id}:{" "}
                      {attack.stat.value} · {attack.skill.id}:{" "}
                      {attack.skill.value}
                    </span>
                    {attack.modifiers.length > 0 && (
                      <span>
                        {attack.modifiers
                          .map(
                            (modifier) =>
                              `${modifier.source} ${modifier.value >= 0 ? "+" : ""}${modifier.value}`,
                          )
                          .join(" · ")}
                      </span>
                    )}
                    <b>Total: {attack.total}</b>
                    {attack.critical && (
                      <small>
                        {attack.critical === "critical_success"
                          ? "Crítico natural: 10"
                          : "Falha crítica natural: 1"}
                      </small>
                    )}
                    {attack.damageDice && (
                      <button
                        type="button"
                        className="roll-damage"
                        onClick={rollDamage}
                      >
                        Rolar dano ({attack.damageDice})
                      </button>
                    )}
                    {lastDamage && lastDamage.attackId === attack.attackId && (
                      <span className="damage-roll">
                        Dano {lastDamage.damageDice}:{" "}
                        {lastDamage.roll.rolls
                          .map((roll) => `[${roll}]`)
                          .join(" ")}{" "}
                        = <b>{lastDamage.total}</b>
                      </span>
                    )}
                  </div>
                );
              })()}
            <h3>Lesões críticas</h3>
            {character.combat.criticalInjuries.length ? (
              <ul className="tag-list">
                {character.combat.criticalInjuries.map((injury) => (
                  <li key={injury}>{injury}</li>
                ))}
              </ul>
            ) : (
              <EmptyState>Nenhuma lesão crítica.</EmptyState>
            )}
          </section>
          <section className="sheet-panel ip-panel">
            <PanelTitle number="03">Progressão</PanelTitle>
            <p>
              IP disponível <strong>{availableIP}</strong>
            </p>
            <div>
              <input
                type="number"
                min="1"
                value={ipToGrant || ""}
                onChange={(event) =>
                  setIpToGrant(Math.max(0, Number(event.target.value) || 0))
                }
                placeholder="IP"
              />
              <button type="button" onClick={grantIP} disabled={!ipToGrant}>
                Adicionar IP
              </button>
            </div>
            <small>IP é separado e só existe após a criação.</small>
          </section>
        </aside>
        <section className="sheet-panel skills-panel">
          <PanelTitle number="04">
            Perícias <span>{Object.keys(character.skills).length}</span>
          </PanelTitle>
          <div className="skills-groups">
            {skillsByStat.map(([stat, skills]) => (
              <div className="skill-group" key={stat}>
                <h3>
                  {stat} <small>{statNames[stat]}</small>
                </h3>
                {skills.map(([id, skill]) => {
                  const cost = getSkillUpgradeCost(skill.level);
                  const canUpgrade = canUpgradeSkill(character, id);
                  return (
                    <div className="skill-row" key={id}>
                      <span>
                        {skill.name}
                        <small>
                          {skill.stat} {skill.base} + nível {skill.level}
                        </small>
                      </span>
                      <button
                        type="button"
                        className="upgrade-skill"
                        disabled={!canUpgrade}
                        onClick={() => improveSkill(id)}
                      >
                        ↑ {cost} IP
                      </button>
                      <strong>{skill.base}</strong>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      </section>
      <StorePanel character={character} onUpdate={onUpdate} />
      {character.rollHistory.some(
        (entry) => entry.type === "humanity_loss",
      ) && (
        <section className="sheet-panel roll-history">
          <PanelTitle number="05">Histórico de Humanidade</PanelTitle>
          {character.rollHistory
            .filter((entry) => entry.type === "humanity_loss")
            .slice(0, 5)
            .map((entry) => (
              <div key={entry.id}>
                <strong>{entry.cyberwareName ?? entry.label}</strong>
                <span>
                  {entry.expression}{" "}
                  {entry.rolls.length
                    ? `→ ${entry.rolls.map((roll) => `[${roll}]`).join(" ")} = ${entry.total}`
                    : `→ ${entry.total}`}
                </span>
                <small>
                  {entry.humanityBefore} → {entry.humanityAfter} Humanidade
                </small>
              </div>
            ))}
        </section>
      )}
      <section className="equipment-layout">
        <section className="sheet-panel">
          <PanelTitle number="05">Armas</PanelTitle>
          {character.weapons.length ? (
            <div className="equipment-list">
              {character.weapons.map((weapon) => (
                <article key={weapon.id}>
                  <h3>{weapon.name}</h3>
                  <p>
                    {weapon.damage}{" "}
                    {weapon.rateOfFire ? `• ROF ${weapon.rateOfFire}` : ""}
                  </p>
                  <small>
                    {weapon.skill
                      ? `Perícia: ${weapon.skill}`
                      : "Sem perícia definida"}
                    {weapon.magazine !== undefined
                      ? ` • Munição ${weapon.ammo ?? 0}/${weapon.magazine}`
                      : ""}
                  </small>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState>Nenhuma arma equipada.</EmptyState>
          )}
        </section>
        <section className="sheet-panel">
          <PanelTitle number="06">Cyberware</PanelTitle>
          {character.cyberware.length ? (
            <div className="equipment-list">
              {character.cyberware.map((item) => (
                <article key={item.id}>
                  <h3>{item.name}</h3>
                  <small>
                    {item.humanityLoss
                      ? `Perda de Humanidade: ${item.humanityLoss}`
                      : "Sem perda de Humanidade"}
                  </small>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState>Nenhum cyberware instalado.</EmptyState>
          )}
        </section>
        <section className="sheet-panel">
          <PanelTitle number="07">Inventário</PanelTitle>
          {character.inventory.length ? (
            <ul className="inventory-list">
              {character.inventory.map((item) => (
                <li key={item.id}>
                  <strong>{item.quantity}×</strong>
                  <span>{item.name}</span>
                  {isEquippableItem(item) && (
                    <button
                      type="button"
                      className="equip-item"
                      onClick={() => equipItem(item.id)}
                    >
                      {item.category === "cyberware" ? "Instalar" : "Equipar"}
                    </button>
                  )}
                  {item.notes && <small>{item.notes}</small>}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Inventário vazio.</EmptyState>
          )}
        </section>
      </section>
    </main>
  );
}
function PanelTitle({
  number,
  children,
}: {
  number: string;
  children: React.ReactNode;
}) {
  return (
    <h2 className="panel-title">
      <span>{number}</span>
      {children}
    </h2>
  );
}
function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
