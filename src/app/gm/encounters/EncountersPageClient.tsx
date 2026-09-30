"use client";

import { useState, useEffect, useCallback } from "react";
import {
  saveEncounter,
  loadEncounters,
  deleteEncounter,
  getEncounter,
  createEncounterFromFaction,
  ensureEncounterIds,
  updateParticipantHP,
  rollAttack,
  rollDamage,
  rollEvasion,
  getEvasionBase,
  getParticipantArmorSP,
  getParticipantAttackModifiers,
  getParticipantDamageExpression,
  getParticipantEvasionModifiers,
  getParticipantInitiativeBonus,
  getParticipantInitiativeModifiers,
  getParticipantAmmoState,
  getParticipantReloadState,
  getParticipantHealingItems,
  getParticipantInventory,
  getParticipantSupplies,
  reloadParticipantWeapon,
  applyParticipantHealingItem,
  applyDamageToParticipant,
  addParticipantCondition,
  removeParticipantCondition,
  clearEncounters,
  type EncounterBattle,
  type EncounterData,
} from "@/lib/gmStorage";
import { gmEnemyCatalog, availableFactions } from "@/data/gm-enemies";
import { bodyCriticalInjuries, headCriticalInjuries } from "@/data/criticalInjuries";
import { rollDice } from "@/lib/dice";
import { notifyEnemyAttack, notifyEnemyDamage, notifyEnemyEvasion, notifyEnemyInitiative } from "@/lib/discord/rollNotify";
import {
  publishMesaGmAttack,
  publishMesaGmDamage,
  publishMesaGmEvasion,
  publishMesaGmInitiative,
} from "@/lib/mesa/gmRollPublish";
import { publishMesaEnemyHp, publishMesaEnemySupplies } from "@/lib/mesa/hpPublish";
import { fetchMesaBattles, listMemberships, MesaApiError } from "@/lib/mesa/client";
import { applyMesaStateToEncounter, reconcileEncountersWithBattles } from "@/lib/mesa/encounterSync";
import { useMesaState } from "@/lib/mesa/useMesaState";
import type { MesaBattle } from "@/lib/mesa/types";
import MesaEncounterStart, { type MesaEnemySeed } from "@/components/mesa/MesaEncounterStart";

/**
 * Trecho de bônus de implante para a linha de resultado, com o sinal certo
 * (` + 2`, ` - 1`, ou nada) — a conta mostrada continua sendo
 * `d10 + base + bônus = total`, igual à ficha do jogador.
 */
function implantBonusText(modifiers: readonly { value: number }[] | undefined): string {
  const bonus = (modifiers ?? []).reduce((sum, modifier) => sum + modifier.value, 0);
  if (bonus === 0) return "";
  return bonus > 0 ? ` + ${bonus}` : ` - ${Math.abs(bonus)}`;
}

/** Lista "Fonte +2 · Outra fonte -1" para o `title` da linha de resultado. */
function implantSourcesText(modifiers: readonly { source: string; value: number }[] | undefined): string {
  if (!modifiers || modifiers.length === 0) return "";
  return modifiers.map((m) => `${m.source} ${m.value >= 0 ? "+" : ""}${m.value}`).join(" · ");
}

/** Selo do vínculo do encontro com uma partida (na lista e nos cartões). */
function battleBadge(battle: EncounterBattle | undefined) {
  if (!battle) return null;
  if (battle.status === "completed") {
    const when = battle.completedAt ? new Date(battle.completedAt) : null;
    const date = when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString("pt-BR") : "";
    return <span className="encounter-badge encounter-badge-done">✅ Concluído{date ? ` · ${date}` : ""}</span>;
  }
  return <span className="encounter-badge encounter-badge-live">⚔ Mesa {battle.joinCode}</span>;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

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
  const [battles, setBattles] = useState<MesaBattle[]>([]);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  // Só um contador: o ↻ do histórico reexecuta o efeito abaixo sem duplicar lógica.
  const [historyTick, setHistoryTick] = useState(0);

  // Combate vinculado a este encontro e ainda em andamento → a MANDA é da
  // mesa: este hook traz o estado (Realtime + polling) para a volta de vida
  // e para a marcação de fim de partida. Sem vínculo, `null` = nada é consultado.
  const linkedSessionId = encounter?.battle?.status === "active" ? encounter.battle.sessionId : null;
  const { state: mesaState } = useMesaState(linkedSessionId);

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

  /**
   * Busca o histórico nas mesas deste navegador em que o papel é Mestre.
   * Só LÊ: aplicar (setters + reconciliação) fica no efeito abaixo, que é quem
   * decide se o resultado ainda importa.
   */
  const fetchHistory = useCallback(async (): Promise<{ list: MesaBattle[]; notice: string | null }> => {
    const gmMesas = listMemberships().filter((entry) => entry.role === "gm");
    let notice: string | null = null;
    const lists = await Promise.all(
      gmMesas.map((entry) =>
        fetchMesaBattles(entry.sessionId).catch((caught: unknown) => {
          // Migração pendente é o único caso que vale explicar ao Mestre.
          if (caught instanceof MesaApiError && caught.code === "migration_pending") notice = caught.message;
          return null;
        }),
      ),
    );

    const list = lists
      .filter((result): result is MesaBattle[] => result !== null)
      .flat()
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return { list, notice };
  }, []);

  /**
   * Histórico do servidor → lista da tela + RECONCILIAÇÃO do vínculo local de
   * cada encontro: partida concluída com a tela fechada, encontro lançado
   * noutro separador, ou lançamento feito sem o vínculo registrado aqui.
   * Roda na montagem, quando a aba muda e quando o Mestre pede ↻ (`historyTick`).
   */
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const { list, notice } = await fetchHistory();
      if (disposed) return; // separador fechado no meio do caminho
      setBattles(list);
      setHistoryNotice(notice);

      const stored = reconcileEncountersWithBattles(loadEncounters(), list);
      if (stored.changed) {
        stored.encounters.forEach((entry) => saveEncounter(entry));
        setSavedEncounters(loadEncounters());
      }
      setEncounter((current) =>
        current ? reconcileEncountersWithBattles([current], list).encounters[0] ?? current : null,
      );
    };
    void refresh();
    return () => {
      disposed = true;
    };
  }, [fetchHistory, phase, historyTick]);

  // Voltou da mesa: vida dos inimigos (morte inclusive) e fim da partida
  // descem para o encontro, que é o registro permanente do Mestre. Só este
  // efeito escreve o encontro — e `applyMesaStateToEncounter` devolve `null`
  // quando nada mudou, então não há loop nem salvamento à toa.
  useEffect(() => {
    if (!mesaState || !encounter) return;
    const apply = () => {
      const next = applyMesaStateToEncounter(encounter, mesaState);
      if (!next) return;
      setEncounter(next);
      saveEncounter(next);
      setSavedEncounters(loadEncounters());
    };
    apply();
  }, [mesaState, encounter]);

  const handleFactionChange = (f: string) => {
    setFaction(f);
    const count = Math.min(4, gmEnemyCatalog.filter((e) => e.identity.faction === f).length || 1);
    setEnemyCount(count);
  };

  /**
   * Os inimigos deste encontro no formato que a mesa partilhada aceita.
   * HP atual é preservado (se o Mestre já aplicou dano antes de lançar o
   * combate online, o inimigo entra ferido — mas com o HP máximo intacto).
   * O `key` carrega o id do participante para o espelho de vida futura.
   */
  const mesaEnemies: MesaEnemySeed[] = (encounter?.participants ?? [])
    .filter((p) => !p.isPlayer)
    .slice(0, 20)
    .map((p) => ({
      name: (p.name || p.archetype || "Inimigo").trim().slice(0, 60),
      hp: Math.max(1, p.hp.current),
      hpMax: Math.max(1, p.hp.max),
      ref: Math.max(1, p.refStat),
      // MOVE do bestiário (encontros salvos antes de existir este campo caem em 5).
      move: Math.max(0, Math.min(20, p.moveStat ?? 5)),
      // Bônus de Iniciativa dos implantes (Sandevistan, Kerenzikov...): a mesa
      // rola `1d10 + REF + bônus` para o inimigo com a mesma regra daqui.
      initiativeBonus: getParticipantInitiativeBonus(p),
      key: p.id,
      // Mochila (pente + reserva) para a linha do inimigo na mesa mostrar.
      supplies: {
        ammo: getParticipantAmmoState(p)?.ammo,
        magazine: getParticipantAmmoState(p)?.magazine,
        inventory: getParticipantInventory(p),
      },
    }));

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
    const found = getEncounter(id);
    if (!found) return;
    // Encontros salvos antes do espelho de HP não têm id por participante:
    // completa aqui e guarda, para a chave não mudar entre uma carga e outra.
    const loaded = ensureEncounterIds(found);
    if (loaded !== found) saveEncounter(loaded);
    setEncounter(loaded);
    setPhase("combat");
    setActiveTab("list");
    setSelectedParticipant(null);
    setDamageValue("");
    setConditionName("");
  };

  const handleSaveEncounter = () => {
    if (!encounter) return;
    saveEncounter(encounter);
    setSavedEncounters(loadEncounters());
  };

  /**
   * O combate subiu na mesa: grava o vínculo NO ENCONTRO (e salva ele).
   * É o que torna o encontro de uso único — e é o que a próxima abertura da
   * tela usa para mostrar "concluído" mesmo depois de fechar o separador.
   */
  const handleBattleStarted = (battle: EncounterBattle) => {
    if (!encounter) return;
    const next = { ...encounter, battle };
    setEncounter(next);
    saveEncounter(next);
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
    const next = updateParticipantHP(encounter, participantIndex, Math.min(newHP, participant.hp.max));
    setEncounter(next);
    setSelectedParticipant(participantIndex);
    // Espelho de vida: a cura feita aqui também sobe na mesa (sem mesa ativa
    // não manda nada; ver hpPublish).
    const healed = next.participants[participantIndex];
    publishMesaEnemyHp(healed.id, healed.hp.current);
  };

  const handleRollAttack = (participantIndex: number) => {
    if (!encounter) return;
    const next = rollAttack(encounter, participantIndex);
    setEncounter(next);
    // Espelho no Discord (mesmos portões do jogador): consentimento + mesa.
    notifyEnemyAttack(next.participants[participantIndex]);
    const p = next.participants[participantIndex];
    if (p.lastAttackRoll) {
      // `key` identifica o inimigo na mesa: o servidor debita a Action DELE
      // (mesma economia do botão ATAQUE) e escreve o Registro com o nome dele.
      publishMesaGmAttack(
        p.name.trim() || p.archetype.trim() || "Inimigo",
        p.weaponName || "Ataque",
        "1d10",
        p.lastAttackRoll.total,
        p.lastAttackRoll.diceRolls,
        p.id,
      );
      // O tiro gastou uma bala: a mesa espelha o pente novo.
      publishMesaEnemySupplies(p.id, p.hp.current, getParticipantSupplies(p));
    }
  };

  const handleRollDamage = (participantIndex: number) => {
    if (!encounter) return;
    const next = rollDamage(encounter, participantIndex);
    setEncounter(next);
    notifyEnemyDamage(next.participants[participantIndex]);
    const p = next.participants[participantIndex];
    if (p.lastDamageRoll) {
      // Sem custo (dano é parte do ataque), mas com a chave o Registro mostra
      // o nome do inimigo em vez do nome do Mestre.
      publishMesaGmDamage(
        p.name.trim() || p.archetype.trim() || "Inimigo",
        `Dano de ${p.weaponName || "ataque"}`,
        p.lastDamageRoll.expression ?? p.damageExpression,
        p.lastDamageRoll.total,
        p.lastDamageRoll.rolls,
        p.id,
      );
    }
  };

  /**
   * 💨 Evasão do inimigo: REF + nível da perícia Evasion + 1d10.
   * Mesmos portões das outras rolagens do cartão: espelho no Discord e na mesa
   * (com `key`, o servidor debita a Action DO inimigo).
   */
  const handleRollEvasion = (participantIndex: number) => {
    if (!encounter) return;
    const next = rollEvasion(encounter, participantIndex);
    setEncounter(next);
    const p = next.participants[participantIndex];
    notifyEnemyEvasion(p);
    if (p.lastEvasionRoll) {
      publishMesaGmEvasion(
        p.name.trim() || p.archetype.trim() || "Inimigo",
        "Evasão",
        `REF ${p.refStat} + ${p.evasionSkillName ?? "Evasão"} ${p.evasionSkillLevel ?? 0} + 1d10`,
        p.lastEvasionRoll.total,
        p.lastEvasionRoll.diceRolls,
        p.id,
      );
    }
  };

  /**
   * ↻ Recarregar o pente do inimigo: consome a reserva da mochila.
   * O botão já vem desabilitado quando não há o que fazer (`getParticipantReloadState`).
   */
  const handleReloadWeapon = (participantIndex: number) => {
    if (!encounter) return;
    const result = reloadParticipantWeapon(encounter, participantIndex);
    if ("error" in result) return;
    setEncounter(result.encounter);
    // A reserva mudou de lugar (pente ← mochila): a mesa acompanha o estado.
    const p = result.encounter.participants[participantIndex];
    publishMesaEnemySupplies(p.id, p.hp.current, getParticipantSupplies(p));
  };

  /**
   * ✚ Usar item de cura da mochila: restaura HP (limitado ao máximo), consome a
   * unidade e espelha a vida na mesa — mesmo caminho do dano aplicado aqui.
   */
  const handleUseHealingItem = (participantIndex: number, itemName: string) => {
    if (!encounter) return;
    const result = applyParticipantHealingItem(encounter, participantIndex, itemName);
    if ("error" in result) return;
    setEncounter(result.encounter);
    const p = result.encounter.participants[participantIndex];
    publishMesaEnemyHp(p.id, p.hp.current);
    publishMesaEnemySupplies(p.id, p.hp.current, getParticipantSupplies(p));
    setSelectedParticipant(participantIndex);
  };

  const handleApplyDamage = (participantIndex: number) => {
    if (!encounter || damageValue === "") return;
    const damage = parseInt(damageValue, 10);
    if (isNaN(damage) || damage <= 0) return;
    const next = applyDamageToParticipant(encounter, participantIndex, damage, ignoreArmor, hitLocation);
    setEncounter(next);
    setDamageValue("");
    setSelectedParticipant(participantIndex);
    // Espelho de vida: o dano aplicado aqui baixa na linha do inimigo na mesa.
    const hit = next.participants[participantIndex];
    publishMesaEnemyHp(hit.id, hit.hp.current);
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
      const ref = p.refStat;
      // Implantes entram aqui (Sandevistan +4, Kerenzikov +2...) — mesma soma
      // que a ficha do jogador faz em `getInitiativeModifiers`.
      const bonus = getParticipantInitiativeBonus(p);
      return { participant: p, roll, ref, bonus, total: roll + ref + bonus };
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
        bonus: r.bonus,
        total: r.total,
      })),
    );
    rolled.forEach((r) => {
      const actor = r.participant.name.trim() || r.participant.archetype.trim() || "Inimigo";
      publishMesaGmInitiative(actor, r.total, r.participant.id);
    });
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
                            {battleBadge(e.battle)}
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
            <div className="encounter-combat-id">
              <span className="encounter-combat-eyebrow">Combate selecionado</span>
              <h2 className="encounter-title">{encounter.name}</h2>
              <div className="encounter-combat-meta">
                <span className="encounter-meta-chip">Facção · {encounter.faction || "—"}</span>
                <span className="encounter-meta-chip">{encounter.participants.length} participantes</span>
              </div>
            </div>
            <div className="encounter-combat-actions">
              <MesaEncounterStart
                enemies={mesaEnemies}
                encounter={{ id: encounter.id, name: encounter.name }}
                battle={encounter.battle ?? null}
                onStarted={handleBattleStarted}
              />
              <button className="gm-button gm-button-small encounter-action-initiative" onClick={handleRollInitiative}>
                <span className="encounter-action-icon" aria-hidden="true">🎲</span>
                Iniciativa
              </button>
            </div>
          </div>

          <div className="encounter-participants">
            {encounter.participants.map((p, index) => {
              const isSelected = selectedParticipant === index;
              const isDown = p.hp.current <= 0;
              const hpPercent = (p.hp.current / p.hp.max) * 100;
              const hpColor = hpPercent > 50 ? "#2e7d32" : hpPercent > 25 ? "#f57f17" : "#c62828";
              // Bônus dos implantes que já entram em cada total mostrado abaixo.
              const attackModifiers = getParticipantAttackModifiers(p);
              const evasionModifiers = getParticipantEvasionModifiers(p);
              const initiativeModifiers = getParticipantInitiativeModifiers(p);
              const effectiveBodySP = getParticipantArmorSP(p, "body");
              // Resumo com só o que de fato soma — linha aparece se algum for ≠ 0.
              const implantSummary = (
                [
                  ["Ataque", implantBonusText(attackModifiers)],
                  ["Evasão", implantBonusText(evasionModifiers)],
                  ["Iniciativa", implantBonusText(initiativeModifiers)],
                  ...(effectiveBodySP > p.armor.body
                    ? [["Corpo SP", ` + ${effectiveBodySP - p.armor.body}`]]
                    : []),
                ] as Array<[string, string]>
              )
                .filter(([, text]) => text !== "")
                .map(([label, text]) => `${label}${text}`);
              // Mochila: pente, reserva e curativos (só arma à distância tem pente).
              const ammoState = getParticipantAmmoState(p);
              const reloadState = getParticipantReloadState(p);
              const healingItems = getParticipantHealingItems(p);
              // A munição da reserva já aparece na linha "↻ Recarregar", então a
              // mochila mostra só o que sobra (cura e utilidades).
              const backpack = getParticipantInventory(p).filter(
                (entry) => reloadState?.item?.item !== entry.item,
              );
              const isOutOfAmmo = ammoState !== null && ammoState.ammo <= 0;
              const isFullHP = p.hp.current >= p.hp.max;
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
                      <span className="epc-info-value">
                        C {effectiveBodySP}{effectiveBodySP > p.armor.body ? ` (+${effectiveBodySP - p.armor.body}⚙️)` : ""} · H {p.armor.head}
                      </span>
                    </div>
                    <div className="epc-info-row">
                      <span className="epc-info-label">⚔️ Arma</span>
                      <span className="epc-info-value">{p.weaponName}</span>
                    </div>
                    <div className="epc-info-row">
                      <span className="epc-info-label">🎯 Base</span>
                      <span className="epc-info-value">{p.weaponSkillName} ({p.skillValue}) + REF {p.refStat} = <strong>{p.attackBase}</strong></span>
                    </div>
                    <div className="epc-info-row">
                      <span className="epc-info-label">💨 Evasão</span>
                      <span className="epc-info-value">REF {p.refStat} + nível {p.evasionSkillLevel ?? 0} = <strong>{getEvasionBase(p)}</strong></span>
                    </div>
                    {implantSummary.length > 0 && (
                      <div className="epc-info-row" title="Efeito numérico dos implantes instalados (soma em cada rolagem)">
                        <span className="epc-info-label">⚙️ Implantes</span>
                        <span className="epc-info-value">{implantSummary.join(" · ")}</span>
                      </div>
                    )}
                  </div>

                  {/* ── Rolls ── */}
                  <div className="epc-section epc-rolls">
                    <div className="epc-roll-row">
                      <button
                        className="gm-button gm-button-small"
                        onClick={(e) => { e.stopPropagation(); handleRollAttack(index); }}
                        disabled={isOutOfAmmo}
                        title={isOutOfAmmo ? "Sem munição no pente — recarregue antes de atirar." : undefined}
                      >
                        {isOutOfAmmo ? "🔫 Sem munição" : "🎲 Atacar"}
                      </button>
                      {p.lastAttackRoll != null && (
                        <span
                          className={`epc-roll-result ${p.lastAttackRoll.fumble ? "epc-roll-fumble" : p.lastAttackRoll.critical ? "epc-roll-crit" : ""}`}
                          title={implantSourcesText(p.lastAttackRoll.modifiers) || undefined}
                        >
                          {p.lastAttackRoll.fumble && "💀 "}
                          {p.lastAttackRoll.critical && "⚡ "}
                          d10({p.lastAttackRoll.diceRolls.join(", ")}) + {p.attackBase}{implantBonusText(p.lastAttackRoll.modifiers)} = <strong>{p.lastAttackRoll.total}</strong>
                        </span>
                      )}
                    </div>
                    {reloadState && (
                      <div className="epc-roll-row">
                        <button
                          className="gm-button gm-button-small"
                          onClick={(e) => { e.stopPropagation(); handleReloadWeapon(index); }}
                          disabled={!reloadState.canReload}
                          title={reloadState.reason ?? undefined}
                        >
                          ↻ Recarregar
                        </button>
                        <span
                          className={`epc-roll-result epc-ammo-result ${reloadState.ammo <= 0 ? "epc-ammo-empty" : ""}`}
                          title={reloadState.item ? `Reserva: ${reloadState.item.item}` : "Sem munição compatível na mochila"}
                        >
                          pente {reloadState.ammo}/{reloadState.magazine}
                          {reloadState.item && ` · reserva ${reloadState.reserve}`}
                        </span>
                      </div>
                    )}
                    <div className="epc-roll-row">
                      <button
                        className="gm-button gm-button-small"
                        onClick={(e) => { e.stopPropagation(); handleRollDamage(index); }}
                      >
                        🔥 Dano ({getParticipantDamageExpression(p)})
                      </button>
                      {p.lastDamageRoll != null && (
                        <span className="epc-roll-result epc-damage-result">
                          {p.lastDamageRoll.expression && p.lastDamageRoll.expression !== p.damageExpression
                            ? `${p.lastDamageRoll.expression}: `
                            : ""}
                          {p.lastDamageRoll.rolls.join(" + ")} = <strong>{p.lastDamageRoll.total}</strong> dmg
                        </span>
                      )}
                    </div>
                    <div className="epc-roll-row">
                      <button
                        className="gm-button gm-button-small"
                        onClick={(e) => { e.stopPropagation(); handleRollEvasion(index); }}
                      >
                        💨 Evasão
                      </button>
                      {p.lastEvasionRoll != null && (
                        <span
                          className={`epc-roll-result ${p.lastEvasionRoll.fumble ? "epc-roll-fumble" : p.lastEvasionRoll.critical ? "epc-roll-crit" : ""}`}
                          title={implantSourcesText(p.lastEvasionRoll.modifiers) || undefined}
                        >
                          {p.lastEvasionRoll.fumble && "💀 "}
                          {p.lastEvasionRoll.critical && "⚡ "}
                          d10({p.lastEvasionRoll.diceRolls.join(", ")}) + {getEvasionBase(p)}{implantBonusText(p.lastEvasionRoll.modifiers)} = <strong>{p.lastEvasionRoll.total}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── Mochila ── */}
                  {backpack.length > 0 && (
                    <div className="epc-section epc-supplies">
                      <div className="epc-supplies-label">🎒 Mochila</div>
                      <div className="epc-supplies-list">
                        {backpack.map((entry) => {
                          const healAmount = healingItems.find((h) => h.name === entry.item)?.amount ?? null;
                          const canUse = healAmount !== null && !isFullHP && entry.quantity > 0;
                          return (
                            <span
                              key={entry.item}
                              className={`epc-supply ${healAmount !== null ? "epc-supply-heal" : ""}`}
                            >
                              <span className="epc-supply-qty">{entry.quantity}×</span>
                              {entry.item}
                              {healAmount !== null && (
                                <button
                                  className="epc-supply-use"
                                  disabled={!canUse}
                                  title={
                                    isFullHP
                                      ? "HP já está no máximo."
                                      : `Usar ${entry.item} — recupera ${healAmount} HP`
                                  }
                                  onClick={(e) => { e.stopPropagation(); handleUseHealingItem(index, entry.item); }}
                                >
                                  ✚ {healAmount}
                                </button>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── Tags ── */}
                  {(p.conditions.length > 0 || (p.personalityTraits && p.personalityTraits.length > 0) || (p.implants && p.implants.length > 0)) && (
                    <div className="epc-section epc-tags">
                      {p.implants && p.implants.length > 0 && (
                        <div className="epc-tag-group">
                          {p.implants.map((implant) => (
                            <span
                              key={implant}
                              className="epc-tag epc-tag-implant"
                              title="Implante — soma nos dados que o inimigo rola (passe o mouse nas rolagens para ver a fonte)"
                            >
                              ⚙️ {implant}
                            </span>
                          ))}
                        </div>
                      )}
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
                              <span className="epc-zone-sp">SP {effectiveBodySP}</span>
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
                      {battleBadge(e.battle)}
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

      {(battles.length > 0 || historyNotice) && (
        <section className="encounter-history">
          <div className="encounter-history-header">
            <div className="encounter-history-header-left">
              <span className="encounter-history-icon">📜</span>
              <div>
                <h2 className="encounter-history-title">Histórico de partidas</h2>
                <span className="encounter-history-count">
                  {battles.length} partida{battles.length !== 1 ? "s" : ""} registrada{battles.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
            <button className="gm-button gm-button-small" onClick={() => setHistoryTick((tick) => tick + 1)}>
              ↻ Atualizar
            </button>
          </div>

          {historyNotice && <p className="mesa-notice error">{historyNotice}</p>}

          <div className="encounter-history-list">
            {battles.map((battle) => (
              <article key={battle.id} className="encounter-history-card">
                <div className="encounter-history-card-header">
                  <span className="encounter-history-name">{battle.encounterName}</span>
                  <span className={`encounter-history-status ${battle.status}`}>
                    {battle.status === "completed" ? "✅ Concluída" : "⚔ Em andamento"}
                  </span>
                </div>
                <p className="encounter-history-meta">
                  Mesa {battle.joinCode} · {formatDateTime(battle.startedAt)}
                  {battle.endedAt && <> → {formatDateTime(battle.endedAt)}</>}
                  {battle.finalRound ? <> · {battle.finalRound}ª rodada</> : null}
                </p>
                {battle.combatants.length > 0 && (
                  <ul className="encounter-history-rows">
                    {battle.combatants.map((row) => (
                      <li key={row.id} className={row.isDead ? "is-dead" : undefined}>
                        <span className="encounter-history-combatant">{row.name}</span>
                        <span className="encounter-history-hp">
                          {row.removed
                            ? `${row.hpStart}/${row.hpMax} · saiu`
                            : row.hpEnd === null
                              ? `${row.hpStart}/${row.hpMax}`
                              : `${row.hpEnd}/${row.hpMax}`}
                          {row.hpEnd !== null && !row.removed && row.hpEnd !== row.hpStart
                            ? ` (${row.hpStart} no início)`
                            : null}
                        </span>
                        {row.isDead && <span className="encounter-history-dead">☠</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
