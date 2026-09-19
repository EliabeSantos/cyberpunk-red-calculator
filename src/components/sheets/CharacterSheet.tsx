"use client";

import { useState } from "react";

import {
  canUpgradeSkill,
  getSkillUpgradeCost,
  grantImprovementPoints,
  upgradeSkill,
} from "@/lib/progression";
import { equipInventoryItem, isEquippableItem } from "@/lib/inventory";
import { applyReceivedDamage, rollDamageForLastAttack } from "@/lib/damage";
import { getSkillBase } from "@/lib/calculations";
import { rollEvasion } from "@/lib/attacks";
import type { HumanityLossResult } from "@/lib/humanity";
import StorePanel from "@/components/sheets/StorePanel";
import AttackActions from "@/components/combat/AttackActions";
import type { AttackRollResult, DamageRollResult, EvasionRollResult } from "@/types/attack";
import type { AttributeName, Character } from "@/types/character";
import type { SkillCategory } from "@/data/skills";
import { hitLocationLabels, hitLocations, type HitLocation } from "@/types/combat";
import { roleDefinitions } from "@/data/roles";
import { getSellPrice, sellInventoryItem } from "@/lib/store";
import { getCatalogItem } from "@/data/items";
import { getCombatAwarenessTotal, getMakerSpecialtyPoints, getMedicineSpecialtyPoints, getNetActionsPerTurn, getRoleAbilityIPCost, spendIPOnRoleAbility } from "@/lib/roles";

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
  const [lastEvasion, setLastEvasion] = useState<EvasionRollResult | null>(null);
  const [receivedDamage, setReceivedDamage] = useState("");
  const [hitLocation, setHitLocation] = useState<HitLocation>("body");
  const [combatError, setCombatError] = useState("");
  const categoryOrder: SkillCategory[] = ["awareness", "body", "control", "education", "fighting", "performance", "ranged_weapon", "social", "technique"];
  const categoryNames: Record<SkillCategory, string> = {
    awareness: "Awareness", body: "Body", control: "Control", education: "Education", fighting: "Fighting", performance: "Performance", ranged_weapon: "Ranged Weapon", social: "Social", technique: "Technique",
  };
  const skillsByCategory = categoryOrder
    .map((category) => [category, Object.entries(character.skills).filter(([, skill]) => skill.category === category)] as const)
    .filter(([, skills]) => skills.length > 0);
  const availableIP = character.ip;
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
  function improveRole(roleId: import("@/types/roles").RoleId) {
    const updated = spendIPOnRoleAbility(character, roleId);
    if (updated) onUpdate(updated);
  }
  function rollDamage() {
    const resolution = rollDamageForLastAttack(character);
    if ("error" in resolution) return;
    onUpdate(resolution.character);
    setLastDamage(resolution.result);
  }
  function evade() {
    const resolution = rollEvasion(character);
    if ("error" in resolution) { setCombatError(resolution.error); return; }
    setCombatError(""); setLastEvasion(resolution.result); onUpdate(resolution.character);
  }
  function receiveDamage() {
    const resolution = applyReceivedDamage(character, Number(receivedDamage), hitLocation);
    if ("error" in resolution) { setCombatError(resolution.error); return; }
    setCombatError(""); setReceivedDamage(""); onUpdate(resolution.character);
  }
  function sellItem(inventoryItemId: string) {
    const result = sellInventoryItem(character, inventoryItemId);
    if ("error" in result) { setCombatError("Não foi possível vender este item."); return; }
    setCombatError(""); onUpdate(result.character);
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
          <section className="sheet-panel role-panel">
            <PanelTitle number="02">Role</PanelTitle>
            {character.primaryRole ? character.roleAbilities.map((ability) => {
              const role = roleDefinitions[ability.roleId];
              const nextRank = ability.rank + 1;
              const cost = getRoleAbilityIPCost(nextRank);
              return <div className="role-ability" key={ability.roleId}>
                <strong>{role.name}</strong><span>{role.abilityName} · Rank {ability.rank}</span>
                {ability.abilityId === "combat_awareness" && <small>Combat Awareness Points: {getCombatAwarenessTotal(character)} / {ability.rank}</small>}
                {ability.abilityId === "interface" && <small>NET Actions: {getNetActionsPerTurn(ability.rank)}</small>}
                {ability.abilityId === "maker" && <small>Maker specialty points: {getMakerSpecialtyPoints(ability.rank)}</small>}
                {ability.abilityId === "medicine" && <small>Medicine specialty points: {getMedicineSpecialtyPoints(ability.rank)}</small>}
                {ability.rank < 10 && <button type="button" className="upgrade-skill" disabled={availableIP < cost} onClick={() => improveRole(ability.roleId)}>↑ Rank {nextRank} · {cost} IP</button>}
              </div>;
            }) : <EmptyState>Nenhuma Role selecionada.</EmptyState>}
          </section>
          <section className="sheet-panel">
            <PanelTitle number="03">Combate</PanelTitle>
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
            <h3>Defesa</h3>
            <div className="combat-action">
              <span>Evasion <small>DEX + nível + 1d10</small></span>
              <button type="button" className="upgrade-skill" onClick={evade}>Rolar Evasion</button>
            </div>
            {lastEvasion && (
            <div className="evasion-result" role="status">
              <strong>Evasion</strong>
              <span>{lastEvasion.stat.id}: {lastEvasion.stat.value} · Evasion: {lastEvasion.skill.value} · d10: [{lastEvasion.naturalRoll}]</span>
              <b>Total: {lastEvasion.total}</b>
            </div>
          )}
          <h3>Dano recebido</h3>
            <div className="received-damage">
              <select aria-label="Local do dano" value={hitLocation} onChange={(event) => setHitLocation(event.target.value as HitLocation)}>{hitLocations.map((location) => <option key={location} value={location}>{hitLocationLabels[location]}</option>)}</select>
              <input type="number" min="1" step="1" value={receivedDamage} onChange={(event) => setReceivedDamage(event.target.value)} placeholder="Dano" />
              <button type="button" className="upgrade-skill" onClick={receiveDamage}>Receber dano</button>
            </div>
            {combatError && <p className="form-error">{combatError}</p>}
            <h3>Armadura</h3>
            <div className="combat-grid">
              <Metric label="Cabeça" value={`${character.combat.armor.head} SP`} />
              <Metric label="Corpo e membros" value={`${character.combat.armor.body} SP`} />
            </div>
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
            <PanelTitle number="05">Progressão</PanelTitle>
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
          <PanelTitle number="05">
            Perícias <span>{Object.keys(character.skills).length}</span>
          </PanelTitle>
          <div className="skills-groups">
            {skillsByCategory.map(([category, skills]) => (
              <div className="skill-group" key={category}>
                <h3>{categoryNames[category]}</h3>
                {skills.map(([id, skill]) => {
                  const base = getSkillBase(character, id);
                  const cost = getSkillUpgradeCost(skill.level, skill.costMultiplier);
                  const canUpgrade = canUpgradeSkill(character, id);
                  return (
                    <div className="skill-row" key={id}>
                      <span>
                        {skill.name}
                        <small>
                          STAT: {skill.stat} · LEVEL: {skill.level} · BASE: {base}{skill.costMultiplier === 2 ? " · custo x2" : ""}
                        </small>
                      </span>
                      <button type="button" className="upgrade-skill" disabled={!canUpgrade} onClick={() => improveSkill(id)}>
                        ↑ {cost} IP
                      </button>
                      <strong>{base}</strong>
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
                  <span>{item.name}{item.catalogItemId && (() => { const catalogItem = getCatalogItem(item.catalogItemId); return catalogItem ? <small>Compra: €$ {catalogItem.price.toLocaleString("pt-BR")} · Venda: €$ {getSellPrice(catalogItem.price).toLocaleString("pt-BR")}/un.</small> : null; })()}</span>
                  {item.catalogItemId && <button type="button" className="equip-item" onClick={() => sellItem(item.id)}>Vender 1</button>}
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
