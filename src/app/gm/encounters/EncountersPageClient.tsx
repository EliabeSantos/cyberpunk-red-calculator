"use client";

/* The effect hydrates localStorage-backed encounter data after mount. */
/* eslint-disable react-hooks/set-state-in-effect */

import { createId } from "@/lib/id";

import { useState, useEffect, useCallback } from "react";
import {
  saveEncounter,
  loadEncounters,
  deleteEncounter,
  ensureEncounterIds,
  updateParticipantHP,
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
import { loadRemoteEncounters, removeRemote, saveRemoteEncounter } from "@/lib/toolkitClient";
import { gmEnemyCatalog, availableFactions } from "@/data/gm-enemies";
import {
  buildEncounterRoster,
  createEncounterFromRoster,
  type EncounterRosterRequest,
} from "@/lib/encounterRoster";
import { bodyCriticalInjuries, headCriticalInjuries } from "@/data/criticalInjuries";
import { rollDice } from "@/lib/dice";
import { notifyEnemyDamage, notifyEnemyEvasion, notifyEnemyInitiative } from "@/lib/discord/rollNotify";
import {
  publishMesaGmDamage,
  publishMesaGmEvasion,
} from "@/lib/mesa/gmRollPublish";
import { publishMesaEnemyHp, publishMesaEnemySupplies, publishMesaEngineDamage } from "@/lib/mesa/hpPublish";
import { getEnemyBodySP } from "@/lib/enemyCyberware";
import { attackMesa, MesaApiError, rollInitiative } from "@/lib/mesa/client";
import { applyMesaStateToEncounter } from "@/lib/mesa/encounterSync";
import { findParticipantById, toggleParticipantSelection } from "@/lib/participantSelection";
import { useMesaState } from "@/lib/mesa/useMesaState";
import type { AttackResult, DamageResult } from "@/lib/combat/contract";
import type { DiceResult } from "@/lib/dice";
import MesaEncounterStart, { type MesaEnemySeed } from "@/components/mesa/MesaEncounterStart";
import {
  ListIcon,
  PlayIcon,
  RotateCwIcon,
  SaveIcon,
  SwordsIcon,
  TrashIcon,
  UsersIcon,
} from "@/components/icons";

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

/** Nível 1–4 derivado da ameaça do inimigo (low → extreme). */
function threatToLevel(threatLevel: string): number {
  if (threatLevel === "extreme") return 4;
  if (threatLevel === "high") return 3;
  if (threatLevel === "medium") return 2;
  return 1;
}

/** Selo do vínculo do encontro com uma partida (na lista e nos cartões). */
function battleBadge(battle: EncounterBattle | undefined) {
  if (!battle || battle.status === "completed") return null;
  // Partida viva = acento, igual a todo o resto do sistema.
  return (
    <span className="encounter-badge encounter-badge-live">
      <span className="encounter-badge-dot" aria-hidden="true" />
      Mesa {battle.joinCode}
    </span>
  );
}

interface ServerAttackFeedback {
  attackResult: AttackResult;
  weaponDamage?: DiceResult;
  damageResult?: DamageResult;
  damageError?: { code: string; message: string };
  ammoAfter?: number;
}

function serverAttackType(participant: NonNullable<EncounterData["participants"]>[number]): string | undefined {
  if (participant.weaponAttackType === "melee") return "melee";
  if (participant.weaponAttackType === "thrown") return "thrown_weapon";
  if (participant.weaponAttackType === "ranged") return "weapon";
  return undefined;
}

export default function EncountersPageClient() {
  const [phase, setPhase] = useState<"setup" | "combat" | "saved">("setup");
  const [faction, setFaction] = useState("");
  const [enemyCount, setEnemyCount] = useState(1);
  const [encounterName, setEncounterName] = useState("");
  const [encounter, setEncounter] = useState<EncounterData | null>(null);
  const [savedEncounters, setSavedEncounters] = useState<EncounterData[]>([]);
  const [activeTab, setActiveTab] = useState<"new" | "list">("new");
  // Seleção guarda o **id** do participante, não a posição: `handleRollInitiative`
  // reordena `encounter.participants` e um índice ficaria apontando para outro
  // inimigo (F0.5). O participante é derivado em `selectedParticipant` abaixo.
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const [damageValue, setDamageValue] = useState("");
  const [ignoreArmor, setIgnoreArmor] = useState(false);
  const [hitLocation, setHitLocation] = useState<"head" | "body">("body");
  const [conditionName, setConditionName] = useState("");
  const [showConfirmDelete, setShowConfirmDelete] = useState<string | null>(null);
  const [minLevel, setMinLevel] = useState(1);
  const [maxLevel, setMaxLevel] = useState(4);
  const [previewSeed, setPreviewSeed] = useState(0);
  const [toolkitError, setToolkitError] = useState<string | null>(null);

  const persistEncounter = useCallback((value: EncounterData) => {
    saveEncounter(value);
    void saveRemoteEncounter(value).catch((error: unknown) => setToolkitError(error instanceof Error ? error.message : "Não foi possível salvar o encontro no servidor."));
  }, []);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [attackMode, setAttackMode] = useState<"normal" | "aimed">("aimed");
  const [aimedTarget, setAimedTarget] = useState<"head" | "leg" | "held_item">("head");
  const [attackBusyId, setAttackBusyId] = useState<string | null>(null);
  const [attackFeedback, setAttackFeedback] = useState<Record<string, ServerAttackFeedback>>({});
  const [attackError, setAttackError] = useState<string | null>(null);
  const [initiativeBusy, setInitiativeBusy] = useState(false);

  // Combate vinculado a este encontro e ainda em andamento → a MANDA é da
  // mesa: este hook traz o estado (Realtime + polling) para a volta de vida
  // e para a marcação de fim de partida. Sem vínculo, `null` = nada é consultado.
  const linkedSessionId = encounter?.battle?.status === "active" ? encounter.battle.sessionId : null;
  const { state: mesaState, refresh: refreshMesaState } = useMesaState(linkedSessionId);

  /**
   * O roster: UM objeto para o preview e para a criação (`src/lib/encounterRoster`).
   * Facção, intervalo de nível, contagem e semente são os mesmos nos dois lados,
   * então o que a tela lista é exatamente o que "Iniciar encontro" materializa.
   */
  const rosterRequest: EncounterRosterRequest = {
    faction,
    minLevel,
    maxLevel,
    count: enemyCount,
    seed: previewSeed,
  };

  const previewEnemies = buildEncounterRoster(rosterRequest);
  // Espaços vazios numerados do estado inicial: deixam visível quantos
  // inimigos entram sem inventar nome nenhum.
  const ghostSlots = Math.min(Math.max(enemyCount, 1), 6);
  const ghostOverflow = enemyCount - ghostSlots;

  /** Uma frase dizendo onde o "Iniciar encontro" está travado — ou pronto. */
  const describeStart = (): string => {
    if (!faction) return "Sem facção · roster vazio";
    if (previewEnemies.length === 0) return `Nível ${minLevel}–${maxLevel} sem inimigos`;
    if (!encounterName.trim()) return "Falta o nome do encontro";
    return `${previewEnemies.length} inimigo${previewEnemies.length !== 1 ? "s" : ""} · nível ${minLevel}–${maxLevel}`;
  };

  // Load saved encounters
  useEffect(() => {
    let disposed = false;
    void loadRemoteEncounters().then((entries) => { if (!disposed) setSavedEncounters(entries); })
      .catch((error: unknown) => { if (!disposed) { setSavedEncounters(loadEncounters()); setToolkitError(error instanceof Error ? error.message : "Não foi possível carregar os encontros do servidor."); } });
    return () => { disposed = true; };
  }, [phase]);

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
      persistEncounter(next);
      setSavedEncounters((current) => current.map((entry) => entry.id === next.id ? next : entry));
    };
    apply();
  }, [mesaState, encounter, persistEncounter]);

  const handleFactionChange = (f: string) => {
    setFaction(f);
    const count = Math.min(4, gmEnemyCatalog.filter((e) => e.identity.faction === f).length || 1);
    setEnemyCount(count);
  };

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
      snapshot: p,
    }));

  const handleStartEncounter = () => {
    if (!faction || !encounterName.trim()) return;
    // Mesmo `rosterRequest` do preview: a criação NÃO escolhe os inimigos de novo.
    const newEncounter = createEncounterFromRoster(encounterName.trim(), rosterRequest);
    if (newEncounter.participants.length === 0) return;
    setEncounter(newEncounter);
    setPhase("combat");
    setActiveTab("new");
    setSelectedParticipantId(null);
    setDamageValue("");
    setConditionName("");
  };

  const handleLoadEncounter = (id: string) => {
    const found = savedEncounters.find((entry) => entry.id === id) ?? null;
    if (!found) return;
    // Encontros salvos antes do espelho de HP não têm id por participante:
    // completa aqui e guarda, para a chave não mudar entre uma carga e outra.
    const loaded = ensureEncounterIds(found);
    if (loaded !== found) persistEncounter(loaded);
    setEncounter(loaded);
    setPhase("combat");
    setActiveTab("list");
    setSelectedParticipantId(null);
    setDamageValue("");
    setConditionName("");
  };

  const handleSaveEncounter = () => {
    if (!encounter) return;
    persistEncounter(encounter);
    setSavedEncounters((current) => current.some((entry) => entry.id === encounter.id) ? current.map((entry) => entry.id === encounter.id ? encounter : entry) : [...current, encounter]);
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
    persistEncounter(next);
    setSavedEncounters((current) => current.map((entry) => entry.id === next.id ? next : entry));
  };

  const handleDeleteEncounter = (id: string) => {
    void removeRemote("encounter", id).then(() => { deleteEncounter(id); setSavedEncounters((current) => current.filter((entry) => entry.id !== id)); })
      .catch((error: unknown) => setToolkitError(error instanceof Error ? error.message : "Não foi possível excluir o encontro."));
    setShowConfirmDelete(null);
  };

  const handleClearAll = () => {
    void Promise.all(savedEncounters.map((entry) => removeRemote("encounter", entry.id))).then(() => {
      clearEncounters();
      setSavedEncounters([]);
      setPhase("setup");
      setEncounter(null);
    }).catch((error: unknown) => setToolkitError(error instanceof Error ? error.message : "Não foi possível remover os encontros."));
  };

  const handleHeal = (participantIndex: number) => {
    if (!encounter) return;
    const participant = encounter.participants[participantIndex];
    const newHP = participant.hp.current + 1;
    const next = updateParticipantHP(encounter, participantIndex, Math.min(newHP, participant.hp.max));
    setEncounter(next);
    // Espelho de vida: a cura feita aqui também sobe na mesa (sem mesa ativa
    // não manda nada; ver hpPublish).
    const healed = next.participants[participantIndex];
    // Seleção reafirmada pelo ID do participante curado, não pela posição.
    setSelectedParticipantId(healed.id ?? null);
    // `hpBefore` = vida ANTES da cura: precondição do servidor (F1.7.1) contra
    // sobrescrever, com atraso, um resultado mais novo na mesa.
    publishMesaEnemyHp(healed.id, healed.hp.current, participant.hp.current);
  };

  const handleServerAttack = async (participantIndex: number) => {
    if (!encounter || !mesaState || !selectedTargetId) return;
    const p = encounter.participants[participantIndex];
    if (!p.id || !p.weaponId) {
      setAttackError("Este inimigo não possui uma identidade de arma válida no snapshot da Mesa.");
      return;
    }
    const actor = mesaState.combatants.find((row) => row.kind === "enemy" && row.sourceKey === p.id);
    if (!actor) {
      setAttackError("O atacante não está presente no combate server-side.");
      return;
    }

    setAttackBusyId(p.id);
    setAttackError(null);
    try {
      const response = await attackMesa({
        sessionId: mesaState.session.id,
        actorId: actor.id,
        targetId: selectedTargetId,
        weaponId: p.weaponId,
        attackType: serverAttackType(p),
        attackMode,
        ...(attackMode === "aimed" ? { aimedTarget } : {}),
      });
      setAttackFeedback((current) => ({
        ...current,
        [p.id!]: {
          ...response,
        },
      }));
      if (response.ammoAfter !== undefined) {
        setEncounter((current) => {
          if (!current) return current;
          return {
            ...current,
            participants: current.participants.map((participant) =>
              participant.id === p.id ? { ...participant, ammo: response.ammoAfter } : participant,
            ),
          };
        });
      }
    } catch (caught) {
      if (caught instanceof MesaApiError) {
        setAttackError(`${caught.code}: ${caught.message}`);
      } else {
        setAttackError("Não foi possível resolver o ataque na Mesa.");
      }
    } finally {
      setAttackBusyId(null);
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
    // A reserva mudou de lugar (pente ← mochila): a mesa acompanha o estado
    // (vida intacta → `hpBefore` igual ao atual, mesma guarda do tiro).
    const p = result.encounter.participants[participantIndex];
    publishMesaEnemySupplies(p.id, p.hp.current, getParticipantSupplies(p), p.hp.current);
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
    // `hpBefore` = vida da ORIGEM antes da cura (a clausura `encounter` é o
    // estado pré-mudança) — precondição do servidor, F1.7.1.
    const hpBefore = encounter.participants[participantIndex].hp.current;
    publishMesaEnemyHp(p.id, p.hp.current, hpBefore);
    publishMesaEnemySupplies(p.id, p.hp.current, getParticipantSupplies(p), hpBefore);
    setSelectedParticipantId(p.id ?? null);
  };

  const handleApplyDamage = (participantIndex: number) => {
    if (!encounter || damageValue === "") return;
    const damage = parseInt(damageValue, 10);
    if (isNaN(damage) || damage <= 0) return;
    const before = encounter.participants[participantIndex];
    const next = applyDamageToParticipant(encounter, participantIndex, damage, ignoreArmor, hitLocation);
    setEncounter(next);
    setDamageValue("");
    const hit = next.participants[participantIndex];
    // Reafirma a seleção pelo ID do participante atingido — nunca pelo índice.
    setSelectedParticipantId(hit.id ?? null);

    // F1.7.1 — primeiro caminho REAL do Combat Engine: o HP/morte do inimigo na
    // mesa sai da resolução do SERVIDOR (POST /combat/damage) com as mesmas
    // entradas canônicas que o `applyDamageToParticipant` acima usou (dano,
    // local, veste, SP do corpo) e `hpBefore` = vida ANTES do golpe — a
    // precondição que recusa retry/estado desatualizado (409). Sem combate
    // ativo a rota responde `updated:false` (o espelho antigo também não
    // faria nada). Em RECUSA o fallback é o espelho com a MESMA precondição:
    // ele só grava se a linha ainda estiver no HP que a origem acreditava.
    const key = hit.id;
    if (key) {
      void publishMesaEngineDamage({
        key,
        amount: damage,
        hpBefore: before.hp.current,
        hitLocation,
        ignoreArmor,
        armor: { head: before.armor.head, body: before.armor.body },
        bodySP: getEnemyBodySP(before.implants),
      }).catch(() => publishMesaEnemyHp(key, hit.hp.current, before.hp.current));
    }
  };

  const handleAddCondition = (participantIndex: number) => {
    if (!encounter || conditionName.trim() === "") return;
    const next = addParticipantCondition(encounter, participantIndex, {
      id: createId(),
      name: conditionName.trim(),
    });
    setEncounter(next);
    setConditionName("");
    setSelectedParticipantId(next.participants[participantIndex].id ?? null);
  };

  const handleRemoveCondition = (participantIndex: number, conditionId: string) => {
    if (!encounter) return;
    setEncounter(removeParticipantCondition(encounter, participantIndex, conditionId));
  };

  const handleSelectParticipant = (participantId: string | null) => {
    setSelectedParticipantId(toggleParticipantSelection(selectedParticipantId, participantId));
    setDamageValue("");
    setIgnoreArmor(false);
    setHitLocation("body");
    setConditionName("");
  };

  const handleRollInitiative = async () => {
    if (!encounter) return;
    if (linkedSessionId) {
      if (!mesaState || initiativeBusy) return;
      setInitiativeBusy(true);
      try {
        await rollInitiative(mesaState.session.id);
        await refreshMesaState();
      } catch (caught) {
        setAttackError(caught instanceof MesaApiError ? caught.message : "Não foi possível rolar a iniciativa da Mesa.");
      } finally {
        setInitiativeBusy(false);
      }
      return;
    }
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
  };

  /**
   * Participante selecionado DERIVADO do id — nunca da posição. Depois que
   * `handleRollInitiative` reescreve a lista em ordem de iniciativa, um índice
   * guardado apontaria para outro inimigo; o id é o mesmo (F0.5).
   */
  const selectedParticipant = encounter
    ? findParticipantById(encounter.participants, selectedParticipantId)
    : null;
  const mesaTargets = mesaState?.combatants.filter((combatant) => combatant.kind === "character" && !combatant.isDead) ?? [];

  // Cabeçalho acompanha a fase: a tela muda de propósito (montar →
  // acompanhar → retomar) e o selo de estado diz em qual delas se está.
  const phaseLabel = phase === "combat" ? "Em combate" : phase === "saved" ? "Encontros salvos" : "Sem encontro ativo";
  const pageSubtitle =
    phase === "combat"
      ? "Acompanhe HP, condições e iniciativa de cada participante."
      : phase === "saved"
        ? "Retome um encontro salvo de onde ele parou."
        : "Monte o encontro, gere o roster e inicie o combate.";

  return (
    <div className="gm-page gm-encounters-page">
      {toolkitError && <div role="alert" className="gm-access-denied">{toolkitError}</div>}
      <header className="gm-page-header">
        <div className="gm-page-header-main">
          <span className="gm-page-eyebrow">OPERAÇÃO // ENCONTROS</span>
          <h1 className="gm-page-title">Combate / Encontros</h1>
          <p className="gm-page-subtitle">{pageSubtitle}</p>
        </div>
        <div className="gm-page-header-actions">
          <span className={`gm-phase-chip gm-phase-${phase}`}>
            <span className="gm-phase-dot" aria-hidden="true" />
            {phaseLabel}
          </span>
          {phase === "combat" && (
            <button className="gm-button gm-button-secondary" onClick={handleSaveEncounter}>
              <SaveIcon />
              Salvar encontro
            </button>
          )}
          {savedEncounters.length > 0 && phase === "combat" && (
            <button className="gm-button gm-button-secondary" onClick={() => setPhase("saved")}>
              <ListIcon />
              Encontros salvos
            </button>
          )}
          {phase === "saved" && (
            <button className="gm-button gm-button-secondary" onClick={handleClearAll}>
              <TrashIcon />
              Limpar todos
            </button>
          )}
        </div>
      </header>

      {phase === "setup" && (
        <div className="encounter-setup">
          <section className="encounter-console" aria-label="Configuração do encontro">
            <div className="encounter-console-body">
              <div className="gm-form-field">
                <label className="gm-form-label" htmlFor="encounter-name">
                  Nome do encontro <span className="encounter-required">*</span>
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

              <div className="encounter-field-row">
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
                    <option value="">— Selecione —</option>
                    {availableFactions.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <div className="gm-form-field">
                  <label className="gm-form-label" htmlFor="encounter-count">Inimigos</label>
                  <input
                    id="encounter-count"
                    className="gm-form-input"
                    type="number"
                    min={1}
                    max={12}
                    value={enemyCount}
                    onChange={(e) => setEnemyCount(parseInt(e.target.value, 10) || 1)}
                  />
                  <small className="gm-form-hint">até 12</small>
                </div>
              </div>
            </div>

            <footer className="encounter-console-foot">
              <p className={`encounter-console-summary${faction && encounterName.trim() ? " is-ready" : ""}`}>
                {describeStart()}
              </p>
              <button
                className="gm-button gm-button-primary encounter-start-button"
                onClick={handleStartEncounter}
                disabled={!faction || !encounterName.trim()}
              >
                <SwordsIcon className="encounter-start-icon" />
                <span>Iniciar encontro</span>
              </button>
            </footer>
          </section>

          <aside className="encounter-roster" aria-label="Roster do encontro">
            <div className="encounter-roster-head">
              <h2 className="encounter-roster-title">
                <UsersIcon />
                Roster
              </h2>
              <div className="encounter-roster-controls">
                <span className="encounter-level-group">
                  Nível
                  <select
                    className="encounter-minlevel-select"
                    aria-label="Nível mínimo"
                    value={minLevel}
                    onChange={(e) => { setMinLevel(Number(e.target.value)); setPreviewSeed((s) => s + 1); }}
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                  </select>
                  <span className="encounter-level-sep" aria-hidden="true">–</span>
                  <select
                    className="encounter-minlevel-select"
                    aria-label="Nível máximo"
                    value={maxLevel}
                    onChange={(e) => { setMaxLevel(Number(e.target.value)); setPreviewSeed((s) => s + 1); }}
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                  </select>
                </span>
                <button
                  className="gm-icon-button"
                  onClick={() => setPreviewSeed((s) => s + 1)}
                  disabled={!faction}
                  title="Gerar outro roster"
                  aria-label="Gerar outro roster"
                >
                  <RotateCwIcon />
                </button>
              </div>
            </div>

            {!faction ? (
              <div className="encounter-roster-empty">
                <p>Escolha uma facção para gerar o roster deste encontro.</p>
                <ul className="encounter-roster-ghosts" aria-hidden="true">
                  {Array.from({ length: ghostSlots }, (_, i) => (
                    <li key={i} className="encounter-roster-ghost">
                      <span>
                        {i === ghostSlots - 1 && ghostOverflow > 0
                          ? `+${ghostOverflow}`
                          : String(i + 1).padStart(2, "0")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : previewEnemies.length === 0 ? (
              <p className="encounter-roster-empty-msg">
                Nenhum inimigo de {faction} entre os níveis {minLevel} e {maxLevel}. Ajuste o intervalo.
              </p>
            ) : (
              <ul className="encounter-roster-list">
                {previewEnemies.map((source, i) => (
                  <li key={`${previewSeed}-${i}`} className="encounter-roster-item">
                    <span className="encounter-roster-name">
                      {source.identity.name || `${source.identity.archetype} #${i + 1}`}
                    </span>
                    <span className="encounter-roster-meta">
                      <span>{source.identity.archetype}</span>
                      <span className="encounter-roster-stat">Nv {threatToLevel(source.identity.threatLevel)}</span>
                      <span className="encounter-roster-stat">{source.combat.hp.max} HP</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          {savedEncounters.length > 0 && (
            <div className="encounter-setup-saved">
              <div className="encounter-saved-header">
                <div className="encounter-saved-header-left">
                  <ListIcon className="encounter-saved-header-icon" />
                  <div>
                    <h2 className="encounter-saved-header-title">Encontros salvos</h2>
                    <span className="encounter-saved-header-count">
                      {savedEncounters.length} encontro{savedEncounters.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
                <button className="gm-button gm-button-small gm-button-danger" onClick={handleClearAll}>
                  <TrashIcon />
                  Limpar todos
                </button>
              </div>
              <div className="encounter-saved-list">
                {savedEncounters.map((e) => (
                  <div key={e.id} className="encounter-saved-card">
                    <div className="encounter-saved-card-main">
                      <span className="encounter-saved-name">{e.name}</span>
                      <div className="encounter-saved-details">
                        <span className="encounter-saved-detail-badge">{e.faction}</span>
                        <span className="encounter-saved-detail-text">
                          {e.participants.length} inimigo{e.participants.length !== 1 ? "s" : ""}
                        </span>
                        <span className="encounter-saved-detail-sep">·</span>
                        <span className="encounter-saved-detail-text">
                          {new Date(e.createdAt).toLocaleDateString("pt-BR")}
                        </span>
                        {battleBadge(e.battle)}
                      </div>
                    </div>
                    <div className="encounter-saved-actions">
                      <button className="gm-button gm-button-small" onClick={() => handleLoadEncounter(e.id)}>
                        <PlayIcon />
                        Carregar
                      </button>
                      {showConfirmDelete === e.id ? (
                        <>
                          <button
                            className="gm-button gm-button-small gm-button-danger"
                            onClick={() => handleDeleteEncounter(e.id)}
                          >
                            Confirmar
                          </button>
                          <button className="gm-button gm-button-small" onClick={() => setShowConfirmDelete(null)}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button
                          className="gm-icon-button is-danger"
                          onClick={() => setShowConfirmDelete(e.id)}
                          title="Excluir encontro"
                          aria-label={`Excluir encontro ${e.name}`}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
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
              <button className="gm-button gm-button-small encounter-action-initiative" onClick={() => void handleRollInitiative()} disabled={initiativeBusy || Boolean(linkedSessionId && !mesaState)}>
                <span className="encounter-action-icon" aria-hidden="true">🎲</span>
                {initiativeBusy ? "Rolando..." : "Iniciativa"}
              </button>
            </div>
          </div>

          <div className="encounter-attack-panel" role="region" aria-label="Ataque server-authoritative">
            <div className="encounter-attack-panel-title">Ataque da Mesa</div>
            <label className="encounter-attack-field">
              <span>Alvo</span>
              <select
                value={selectedTargetId ?? ""}
                onChange={(event) => setSelectedTargetId(event.target.value || null)}
                disabled={mesaTargets.length === 0}
              >
                <option value="">{mesaTargets.length === 0 ? "Nenhum alvo disponível" : "Escolha um alvo"}</option>
                {mesaTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name} · HP {target.hpCurrent}/{target.hpMax}
                  </option>
                ))}
              </select>
            </label>
            <div className="encounter-attack-field">
              <span>Modo</span>
              <div className="encounter-attack-mode-buttons">
                <button type="button" className={`gm-button gm-button-small ${attackMode === "normal" ? "is-active" : ""}`} onClick={() => setAttackMode("normal")}>
                  Normal
                </button>
                <button
                  type="button"
                  className={`gm-button gm-button-small ${attackMode === "aimed" ? "is-active" : ""}`}
                  onClick={() => setAttackMode("aimed")}
                >
                  Aimed
                </button>
                {attackMode === "aimed" && (
                   <select value={aimedTarget} onChange={(event) => setAimedTarget(event.target.value as "head" | "leg" | "held_item")}>
                     <option value="head">Head</option>
                     <option value="leg">Leg</option>
                     <option value="held_item">Held Item</option>
                  </select>
                )}
              </div>
            </div>
            {attackError && <p className="encounter-attack-error" role="alert">{attackError}</p>}
          </div>

          <div className="encounter-participants">
            {encounter.participants.map((p, index) => {
              // Referência do array: o selecionado é EXATAMENTE este participante,
              // independente de onde a reordenação de iniciativa deixou a posição.
              const isSelected = selectedParticipant === p;
              const mesaCombatant = linkedSessionId
                ? mesaState?.combatants.find((combatant) =>
                    p.isPlayer ? combatant.characterId === p.id : combatant.sourceKey === p.id,
                  )
                : null;
              const isMesaActiveCombatant = Boolean(
                mesaCombatant && mesaState?.combat?.activeCombatantId === mesaCombatant.id,
              );
              const displayedInitiative = linkedSessionId ? mesaCombatant?.initiative ?? null : p.initiative;
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
              const isFullHP = p.hp.current >= p.hp.max;
              // Barra de munição (logo abaixo da de HP) — mesmos patamares,
              // mas em latão para não se confundir com a vida.
              const ammoPercent = ammoState ? (ammoState.ammo / ammoState.magazine) * 100 : 0;
              const ammoColor = ammoPercent > 50 ? "#c9a227" : ammoPercent > 25 ? "#f57f17" : "#c62828";
              return (
                <div
                  key={p.id}
                  className={`encounter-participant-card ${isSelected ? "encounter-participant-selected" : ""} ${isDown ? "encounter-participant-down" : ""}`}
                  onClick={() => handleSelectParticipant(p.id ?? null)}
                >
                  {/* ── Header ── */}
                  <div className="epc-header">
                    <div className="epc-header-left">
                      <span className="epc-name">{p.name || "Sem nome"}</span>
                      {displayedInitiative != null && (
                        <span className="epc-initiative">{displayedInitiative}</span>
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

                    {/* Barra de munição do pente — só arma à distância tem. */}
                    {ammoState && (
                      <>
                        <div className="epc-ammo-row">
                          <span className="epc-ammo-label" title={p.weaponName}>
                            MUNIÇÃO
                          </span>
                          <span className="epc-ammo-value">
                            {ammoState.ammo}<small> / {ammoState.magazine}</small>
                          </span>
                        </div>
                        <div className="epc-ammo-bar">
                          <div
                            className="epc-ammo-fill"
                            style={{ width: `${ammoPercent}%`, backgroundColor: ammoColor }}
                          />
                        </div>
                      </>
                    )}
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
                        onClick={(e) => { e.stopPropagation(); void handleServerAttack(index); }}
                        disabled={attackBusyId === p.id || !selectedTargetId || !p.weaponId || isDown || (Boolean(linkedSessionId) && !isMesaActiveCombatant)}
                        title={!p.weaponId ? "Arma sem identidade server-side." : !selectedTargetId ? "Escolha um alvo na Mesa." : linkedSessionId && !isMesaActiveCombatant ? "Este combatente está fora do turno." : undefined}
                      >
                        {attackBusyId === p.id ? "⏳ Resolvendo…" : "⚔ Atacar na Mesa"}
                      </button>
                      {attackFeedback[p.id ?? ""]?.attackResult && (
                        <span className="epc-roll-result">
                          {(() => {
                            const result = attackFeedback[p.id ?? ""].attackResult;
                            return <>{result.hit ? "✅ HIT" : "❌ MISS"} · d10({result.roll.rolls.join(", ")}) · total <strong>{result.total}</strong> · defesa {result.defenseValue}{result.critical ? " · crítico" : ""}{result.fumble ? " · fumble" : ""}</>;
                          })()}
                        </span>
                      )}
                      {attackFeedback[p.id ?? ""]?.damageResult && (
                        <span className="epc-roll-result epc-damage-result">
                          {(() => {
                            const damage = attackFeedback[p.id ?? ""].damageResult!;
                            return <>Dano {attackFeedback[p.id ?? ""].weaponDamage?.total ?? damage.rawDamage} · {damage.hitLocation} · armor {damage.armorValue} · HP {damage.hpBefore} → <strong>{damage.hpAfter}</strong></>;
                          })()}
                        </span>
                      )}
                      {attackFeedback[p.id ?? ""]?.damageError && (
                        <span className="epc-roll-result epc-roll-fumble">
                          Dano recusado: {attackFeedback[p.id ?? ""].damageError?.message}
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
                          className={`epc-roll-result epc-ammo-result ${reloadState.item ? "" : "epc-ammo-empty"}`}
                          title={reloadState.item ? `Reserva: ${reloadState.item.item}` : "Sem munição compatível na mochila"}
                        >
                          📦 {reloadState.item ? `${reloadState.reserve} balas · ${reloadState.item.item}` : "sem munição"}
                        </span>
                      </div>
                    )}
                    {!attackFeedback[p.id ?? ""]?.damageResult && (
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
                    )}
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
          <h2 className="encounter-saved-page-title">
            <ListIcon />
            Encontros salvos
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
                      {e.faction} · {e.participants.length} inimigo{e.participants.length !== 1 ? "s" : ""} ·{" "}
                      {new Date(e.createdAt).toLocaleDateString("pt-BR")}
                      {battleBadge(e.battle)}
                    </span>
                  </div>
                  <div className="encounter-saved-actions">
                    <button className="gm-button gm-button-small" onClick={() => handleLoadEncounter(e.id)}>
                      <PlayIcon />
                      Carregar
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
                      <button
                        className="gm-icon-button is-danger"
                        onClick={() => setShowConfirmDelete(e.id)}
                        title="Excluir encontro"
                        aria-label={`Excluir encontro ${e.name}`}
                      >
                        <TrashIcon />
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
