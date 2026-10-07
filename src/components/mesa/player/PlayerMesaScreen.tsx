"use client";

/**
 * F1.12.3 — **Player Mesa Screen**: a tela completa do Jogador em `/mesa/[id]`.
 *
 *     /mesa/[id]
 *         ↓
 *     PlayerMesaScreen          ← aqui
 *         ↓
 *     useMesaState (Realtime + polling)  →  estado autoritativo do servidor
 *
 * Antes desta etapa a rota mostrava um recorte estático (HP/ataque/eventos) e a
 * experiência COMPLETA só existia dentro do modal/dock (`MesaRoom` →
 * `MesaCombatPanel`). Agora a rota é a experiência principal: turno, economia
 * de ação, iniciativa, seleção de alvo, ataques, ações, equipamento, lesões e
 * registro — tudo derivado do MESMO estado, sem espelho nenhum.
 *
 * Regras desta tela:
 *  - não calcula nada que o servidor decida (rolagem, dano, HP final, munição);
 *  - não guarda estado paralelo de HP/turno/ação/iniciativa;
 *  - um `busy` global: uma mutação por vez, com refresh obrigatório no fim;
 *  - os blocos são `stateless` em relação à Mesa — recebem o snapshot e desenham.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import MesaCharacterLink from "@/components/mesa/MesaCharacterLink";
import { endCombat, fetchMesaControlMetadata, leaveMesa, MesaApiError } from "@/lib/mesa/client";
import { attackTargets, myCombatant } from "@/lib/mesa/playerScreen";
import type { MesaState } from "@/lib/mesa/types";
import type { CombatWeapon } from "@/lib/combat/contract";
import { useAutoLinkCharacter } from "@/lib/mesa/useAutoLinkCharacter";
import { loadCharacters } from "@/lib/storage";
import { tacticalCoverObstacleId } from "@/lib/mesa/tacticalMap";

import CombatLog from "./CombatLog";
import ActionFeedback from "./ActionFeedback";
import GmCombatControlPanel from "./GmCombatControlPanel";
import InitiativePanel from "./InitiativePanel";
import MesaHeader from "./MesaHeader";
import PlayerActionsPanel from "./PlayerActionsPanel";
import PlayerEquipmentPanel from "./PlayerEquipmentPanel";
import PlayerInventoryPanel from "./PlayerInventoryPanel";
import PlayerSkillCheckPanel from "./PlayerSkillCheckPanel";
import PlayerStatusPanel from "./PlayerStatusPanel";
import TurnStatus from "./TurnStatus";
import TacticalView from "./TacticalView";
import type { Notice, NoticeFn, RunAction, RunOptions } from "./types";

interface Props {
  state: MesaState;
  /** `true` = Realtime entregando; `false` = polling (mostrado como reconexão). */
  realtime: boolean;
  onRefresh: () => Promise<void>;
}

export default function PlayerMesaScreen({ state, realtime, onRefresh }: Props) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [targetDraft, setTargetDraft] = useState("");
  const [gmTargetDraft, setGmTargetDraft] = useState("");
  const [selectedWeaponId, setSelectedWeaponId] = useState("");
  const [gmControlledCombatantId, setGmControlledCombatantId] = useState<string | null>(null);
  const [controlWeapons, setControlWeapons] = useState<Record<string, CombatWeapon[]>>({});

  const onNotice = useCallback<NoticeFn>((message, kind) => {
    setNotice({ message, kind });
    window.setTimeout(() => setNotice(null), 5000);
  }, []);

  const onChanged = useCallback(async () => {
    await onRefresh();
  }, [onRefresh]);

  const run = useCallback<RunAction>(
    async (action, options?: RunOptions) => {
      setBusy(true);
      try {
        await action();
        await onChanged();
        if (options?.success) onNotice(options.success, "ok");
      } catch (caught) {
        const message = caught instanceof MesaApiError ? caught.message : "Falha na operação.";
        if (options?.onError) options.onError(message, caught instanceof MesaApiError ? caught.code : undefined);
        else onNotice(message, "error");
        await onChanged().catch(() => undefined);
      } finally {
        setBusy(false);
      }
    },
    [onChanged, onNotice],
  );

  // Vincula a ficha ativa do navegador quando o jogador ainda não escolheu.
  useAutoLinkCharacter(state, onRefresh);

  const sessionFinished = state.session.status === "finished";
  const me = myCombatant(state);
  const targets = useMemo(() => attackTargets(state), [state]);

  // Alvo: mantém a escolha enquanto ela ainda existir; senão cai no primeiro
  // inimigo vivo (derivação pura — nenhum estado paralelo de Mesa).
  const selectedTargetId = useMemo(() => {
    if (targets.some((target) => target.id === targetDraft)) return targetDraft;
    const coverId = tacticalCoverObstacleId(targetDraft);
    const geometry = state.session.tacticalMap?.geometry;
    if (coverId && [...(geometry?.walls ?? []), ...(geometry?.doors ?? [])].some((entry) => entry.id === coverId && entry.destroyed !== true && !(entry.type === "door" && entry.state === "open"))) return targetDraft;
    return targets[0]?.id ?? "";
  }, [state.session.tacticalMap?.geometry, targets, targetDraft]);

  const gmTargets = useMemo(
    () => state.combatants.filter((combatant) => combatant.kind === "character" && !combatant.isDead && combatant.id !== gmControlledCombatantId),
    [gmControlledCombatantId, state.combatants],
  );
  const selectedGmTargetId = useMemo(() => {
    if (gmTargets.some((target) => target.id === gmTargetDraft)) return gmTargetDraft;
    const coverId = tacticalCoverObstacleId(gmTargetDraft);
    const geometry = state.session.tacticalMap?.geometry;
    if (coverId && [...(geometry?.walls ?? []), ...(geometry?.doors ?? [])].some((entry) => entry.id === coverId && entry.destroyed !== true && !(entry.type === "door" && entry.state === "open"))) return gmTargetDraft;
    return gmTargets[0]?.id ?? "";
  }, [gmTargetDraft, gmTargets, state.session.tacticalMap?.geometry]);

  const gmSelectedCombatant = state.combatants.find((combatant) => combatant.id === gmControlledCombatantId) ?? null;

  useEffect(() => {
    if (state.session.status === "finished" || state.combat?.status !== "active") {
      setTargetDraft("");
      setGmTargetDraft("");
      return;
    }
    const geometry = state.session.tacticalMap?.geometry;
    const coverExists = (targetId: string) => {
      const obstacleId = tacticalCoverObstacleId(targetId);
      return obstacleId !== null && [...(geometry?.walls ?? []), ...(geometry?.doors ?? [])].some((entry) => entry.id === obstacleId && entry.destroyed !== true && !(entry.type === "door" && entry.state === "open"));
    };
    if (targetDraft && !targets.some((target) => target.id === targetDraft) && !coverExists(targetDraft)) setTargetDraft("");
    if (gmTargetDraft && !gmTargets.some((target) => target.id === gmTargetDraft) && !coverExists(gmTargetDraft)) setGmTargetDraft("");
  }, [gmTargetDraft, gmTargets, state.combat?.status, state.session.status, targetDraft, targets]);

  const meParticipant = state.participants.find((entry) => entry.id === state.viewer.participantId) ?? null;
  const linkedCharacterId = meParticipant?.characterId ?? null;

  // Ficha local correspondente (só para RÓTULO: os dados da tela vêm da Mesa).
  const characterName = useMemo(() => {
    if (!linkedCharacterId) return null;
    return loadCharacters().find((entry) => entry.id === linkedCharacterId)?.identity.name ?? null;
  }, [linkedCharacterId]);

  const weapons = useMemo(() => {
    if (!linkedCharacterId) return [];
    return loadCharacters().find((entry) => entry.id === linkedCharacterId)?.weapons ?? [];
  }, [linkedCharacterId]);
  const playerSelectedWeapon = useMemo(
    () => weapons.find((weapon) => weapon.id === selectedWeaponId) ?? weapons[0] ?? null,
    [selectedWeaponId, weapons],
  );
  const gmSelectedWeapon = useMemo(
    () => (gmSelectedCombatant ? (controlWeapons[gmSelectedCombatant.id] ?? []).find((weapon) => weapon.id === selectedWeaponId) ?? controlWeapons[gmSelectedCombatant.id]?.[0] ?? null : null),
    [controlWeapons, gmSelectedCombatant, selectedWeaponId],
  );

  async function handleLeave() {
    if (!window.confirm("Sair da mesa? Para voltar você vai precisar do código de novo.")) return;
    setLeaving(true);
    try {
      await leaveMesa(state.session.id, state.session.joinCode);
      router.push("/");
    } catch (caught) {
      onNotice(
        caught instanceof MesaApiError ? caught.message : "Não foi possível sair da mesa.",
        "error",
      );
      setLeaving(false);
    }
  }

  const isGM = state.viewer.role === "gm";
  const combatId = state.combat?.id ?? null;

  useEffect(() => {
    if (!isGM || !combatId) return;
    let cancelled = false;
    void fetchMesaControlMetadata(state.session.id)
      .then((entries) => {
        if (cancelled) return;
        setControlWeapons(Object.fromEntries(entries.map((entry) => [entry.combatantId, entry.weapons])));
      })
      .catch(() => {
        if (!cancelled) setControlWeapons({});
      });
    return () => {
      cancelled = true;
    };
  }, [combatId, isGM, state.session.id]);

  return (
    <main className="player-mesa-page">
      <MesaHeader
        state={state}
        realtime={realtime}
        leaving={leaving}
        busy={busy}
        onNotice={onNotice}
        onLeave={() => void handleLeave()}
        onEndCombat={() => void run(() => endCombat(state.session.id), { success: "Combate encerrado." })}
      />

      {sessionFinished && (
        <p className="player-mesa-notice">Esta Mesa foi encerrada pelo Mestre.</p>
      )}

      {notice && <p className={`mesa-notice ${notice.kind}`}>{notice.message}</p>}

      <ActionFeedback busy={busy} />

      <TurnStatus state={state} me={me} />

      <div className="player-mesa-grid player-mesa-grid-table player-mesa-hud-grid">
        <aside className="player-mesa-column player-mesa-left-rail" aria-label="Player status">
          <PlayerStatusPanel me={me} characterName={characterName} />
          <InitiativePanel
            state={state}
            me={me}
            selectedTargetId={selectedTargetId}
            onSelectTarget={setTargetDraft}
            controlledCombatantId={isGM ? gmControlledCombatantId : null}
            onSelectControl={isGM ? setGmControlledCombatantId : undefined}
          />
        </aside>

        <section className="player-mesa-column player-mesa-stage" aria-label="Game area">
           <TacticalView
             state={state}
             onNotice={onNotice}
             selectedTargetId={isGM ? selectedGmTargetId : selectedTargetId}
             onSelectTarget={isGM ? setGmTargetDraft : setTargetDraft}
             controlledCombatantId={isGM ? gmControlledCombatantId : null}
             selectedWeapon={isGM ? gmSelectedWeapon : playerSelectedWeapon}
           />
          <div className="player-mesa-stage-tools">
            <PlayerEquipmentPanel
              state={state}
              me={me}
              busy={busy}
              run={run}
              onChanged={onChanged}
              weapons={weapons}
            />
            <PlayerInventoryPanel
              state={state}
              me={me}
              busy={busy}
              run={run}
              onChanged={onChanged}
              supplies={me?.supplies ?? null}
            />
            <PlayerSkillCheckPanel
              state={state}
              me={me}
              busy={busy}
              run={run}
              onChanged={onChanged}
              characterId={linkedCharacterId}
            />
          </div>
        </section>

        <aside className="player-mesa-column player-mesa-right-rail" aria-label="Combat actions">
          {isGM ? (
            <GmCombatControlPanel
              state={state}
              busy={busy}
              run={run}
              metadata={controlWeapons}
              sessionFinished={sessionFinished}
               controlledCombatantId={gmControlledCombatantId}
               selectedTargetId={selectedGmTargetId}
               onSelectTarget={setGmTargetDraft}
               selectedWeaponId={selectedWeaponId}
               onSelectWeapon={setSelectedWeaponId}
             />
          ) : (
            <PlayerActionsPanel
              state={state}
              me={me}
              busy={busy}
              run={run}
              onChanged={onChanged}
              weapons={weapons}
              targets={targets}
              selectedTargetId={selectedTargetId}
               onSelectTarget={setTargetDraft}
               selectedWeaponId={selectedWeaponId}
               onSelectWeapon={setSelectedWeaponId}
              sessionFinished={sessionFinished}
            />
          )}

           <details className="player-mesa-panel player-mesa-secondary">
             <summary>Mesa, jogadores e vínculo</summary>

             <ul className="mesa-players">
               {state.participants.map((participant) => (
                 <li
                   key={participant.id}
                   className={participant.id === state.viewer.participantId ? "is-you" : ""}
                 >
                   <span className="mesa-dot" />
                   <strong>{participant.displayName}</strong>
                   <span className="mesa-role">{participant.role === "gm" ? "Mestre" : "Jogador"}</span>
                   <span className="mesa-char">{participant.characterId ? "ficha vinculada" : "sem ficha"}</span>
                 </li>
               ))}
             </ul>

             <MesaCharacterLink
               sessionId={state.session.id}
               selectedCharacterId={linkedCharacterId}
               disabled={sessionFinished}
               onNotice={onNotice}
               onChanged={onChanged}
             />

             <p className="mesa-hint">
               Convite: <code>{`/mesa/${state.session.joinCode}`}</code>
             </p>
           </details>
         </aside>
       </div>

       <CombatLog events={state.combat?.eventLog ?? []} />
    </main>
  );
}
