"use client";

import { createId } from "@/lib/id";

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
import { closeMesa, endCombat, fetchMesaControlMetadata, leaveMesa, MesaApiError } from "@/lib/mesa/client";
import { attackTargets, myCombatant } from "@/lib/mesa/playerScreen";
import type { MesaState } from "@/lib/mesa/types";
import type { CombatWeapon } from "@/lib/combat/contract";
import type { Character } from "@/types/character";
import { getAvailableAttacks } from "@/lib/attacks";
import type { AvailableAttack } from "@/types/attack";
import { useAutoLinkCharacter } from "@/lib/mesa/useAutoLinkCharacter";
import { loadCharacters } from "@/lib/storage";
import { tacticalCoverObstacleId } from "@/lib/mesa/tacticalMap";
import { shouldReconcileAfterAction } from "@/lib/mesa/useMesaState";

import CombatLog from "./CombatLog";
import ActionFeedback from "./ActionFeedback";
import GmCombatControlPanel from "./GmCombatControlPanel";
import InitiativePanel from "./InitiativePanel";
import MesaHeader from "./MesaHeader";
import PlayerActionsPanel from "./PlayerActionsPanel";
import PlayerEquipmentPanel from "./PlayerEquipmentPanel";
import PlayerInventoryPanel from "./PlayerInventoryPanel";
import PlayerSkillCheckPanel from "./PlayerSkillCheckPanel";
import PlayerNetrunnerPanel from "./PlayerNetrunnerPanel";
import GmNetArchitecturePanel from "./GmNetArchitecturePanel";
import PlayerStatusPanel from "./PlayerStatusPanel";
import TurnStatus from "./TurnStatus";
import TacticalView from "./TacticalView";
import type { NoticeFn, RunAction, RunOptions } from "./types";
import FloatingUpdateCard, { type FloatingUpdate } from "@/components/FloatingUpdateCard";
import AppDialog from "@/components/AppDialog";

const EMPTY_WEAPONS: Character["weapons"] = [];

interface Props {
  state: MesaState;
  /** `true` = Realtime entregando; `false` = polling (mostrado como reconexão). */
  realtime: boolean;
  onRefresh: () => Promise<void>;
  getRefreshVersion: () => number;
}

export default function PlayerMesaScreen({ state, realtime, onRefresh, getRefreshVersion }: Props) {
  const router = useRouter();
  const [notice, setNotice] = useState<FloatingUpdate[]>([]);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [targetDraft, setTargetDraft] = useState("");
  const [gmTargetDraft, setGmTargetDraft] = useState("");
  const [selectedWeaponId, setSelectedWeaponId] = useState("");
  const [selectedAttackId, setSelectedAttackId] = useState("");
  const [gmControlledCombatantId, setGmControlledCombatantId] = useState<string | null>(null);
  const [selectedHackableObjectId, setSelectedHackableObjectId] = useState<string | null>(null);
  const [selectedAccessPointId, setSelectedAccessPointId] = useState<string | null>(null);
  const [gmControlMode, setGmControlMode] = useState<"enemy" | "map">("enemy");
  const [controlWeapons, setControlWeapons] = useState<Record<string, { weapons: CombatWeapon[]; attacks: AvailableAttack[] }>>({});

  const onNotice = useCallback<NoticeFn>((message, kind) => {
    const id = createId();
    setNotice((current) => [...current.slice(-3), { id, message, kind }]);
    window.setTimeout(() => setNotice((current) => current.filter((entry) => entry.id !== id)), 5000);
  }, []);

  const onChanged = useCallback(async () => {
    await onRefresh();
  }, [onRefresh]);

  const run = useCallback<RunAction>(
    async (action, options?: RunOptions) => {
      setBusy(true);
      const versionBeforeAction = getRefreshVersion();
      try {
        await action();
        // O Realtime continua sendo primário. Se já aplicou um GET autenticado
        // enquanto o POST estava em andamento, não faça um segundo GET.
        if (shouldReconcileAfterAction(versionBeforeAction, getRefreshVersion())) await onChanged();
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
    [getRefreshVersion, onChanged, onNotice],
  );

  // Vincula a ficha ativa do navegador quando o jogador ainda não escolheu.
  useAutoLinkCharacter(state, onRefresh);

  const sessionFinished = state.session.status === "finished";
  const isGM = state.viewer.role === "gm";
  const me = myCombatant(state);
  const targets = useMemo(() => attackTargets(state), [state]);

  // Alvo: mantém a escolha enquanto ela ainda existir; senão cai no primeiro
  // inimigo vivo (derivação pura — nenhum estado paralelo de Mesa).
  const selectedTargetId = useMemo(() => {
    if (selectedAccessPointId || selectedHackableObjectId) return "";
    if (targets.some((target) => target.id === targetDraft)) return targetDraft;
    const coverId = tacticalCoverObstacleId(targetDraft);
    const geometry = state.session.tacticalMap?.geometry;
    if (coverId && [...(geometry?.walls ?? []), ...(geometry?.doors ?? [])].some((entry) => entry.id === coverId && entry.destroyed !== true && !(entry.type === "door" && entry.state === "open"))) return targetDraft;
    return targets[0]?.id ?? "";
  }, [selectedAccessPointId, selectedHackableObjectId, state.session.tacticalMap?.geometry, targets, targetDraft]);

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
  const isControllingEnemy = isGM && gmSelectedCombatant?.kind === "enemy";
  const displayedCombatant = isControllingEnemy ? gmSelectedCombatant : me;

  const meParticipant = state.participants.find((entry) => entry.id === state.viewer.participantId) ?? null;
  const linkedCharacterId = meParticipant?.characterId ?? null;

  // Uma única leitura da ficha local por render. A Mesa continua sendo a fonte
  // autoritativa; esta ficha só fornece rótulo, armas e ataques disponíveis.
  const localCharacter = useMemo(
    () => linkedCharacterId ? loadCharacters().find((entry) => entry.id === linkedCharacterId) ?? null : null,
    [linkedCharacterId],
  );
  const characterName = localCharacter?.identity.name ?? null;
  const weapons = localCharacter?.weapons ?? EMPTY_WEAPONS;
  const attacks = useMemo<AvailableAttack[]>(
    () => localCharacter ? getAvailableAttacks(localCharacter) : [],
    [localCharacter],
  );
  const playerSelectedWeapon = useMemo(
    () => {
      const selected = attacks.find((attack) => attack.id === selectedAttackId);
      const weaponId = selected?.context.weaponId;
      return weapons.find((weapon) => weapon.id === weaponId) ?? null;
    },
    [attacks, selectedAttackId, weapons],
  );
  const gmSelectedWeapon = useMemo(
    () => {
      if (!gmSelectedCombatant) return null;
      const control = controlWeapons[gmSelectedCombatant.id];
      const selected = control?.attacks.find((attack) => attack.id === selectedAttackId) ?? control?.attacks[0];
      return selected?.context.weaponId ? control?.weapons.find((weapon) => weapon.id === selected.context.weaponId) ?? null : null;
    },
    [controlWeapons, gmSelectedCombatant, selectedAttackId],
  );
  const gmSelectedAttack = gmSelectedCombatant
    ? controlWeapons[gmSelectedCombatant.id]?.attacks.find((attack) => attack.id === selectedAttackId) ?? controlWeapons[gmSelectedCombatant.id]?.attacks[0] ?? null
    : null;
  const playerSelectedAttack = attacks.find((attack) => attack.id === selectedAttackId) ?? attacks[0] ?? null;

  async function handleLeave() {
    setLeaveDialogOpen(false);
    setLeaving(true);
    try {
      if (isGM) await closeMesa(state.session.id, state.session.joinCode);
      else await leaveMesa(state.session.id, state.session.joinCode);
      router.push("/");
    } catch (caught) {
      onNotice(
        caught instanceof MesaApiError ? caught.message : "Não foi possível sair da mesa.",
        "error",
      );
      setLeaving(false);
    }
  }

  const combatId = state.combat?.id ?? null;

  useEffect(() => {
    if (!isGM || !combatId) return;
    let cancelled = false;
    void fetchMesaControlMetadata(state.session.id)
      .then((entries) => {
        if (cancelled) return;
         setControlWeapons(Object.fromEntries(entries.map((entry) => [entry.combatantId, { weapons: entry.weapons, attacks: entry.attacks }])));
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
        onLeave={() => setLeaveDialogOpen(true)}
        onEndCombat={() => void run(() => endCombat(state.session.id), { success: "Combate encerrado." })}
      />

      {sessionFinished && (
        <p className="player-mesa-notice">Esta Mesa foi encerrada pelo Mestre.</p>
      )}

      <FloatingUpdateCard updates={notice} />

      <AppDialog
        open={leaveDialogOpen}
        kind="confirm"
        title={isGM ? "Encerrar mesa?" : "Sair da mesa?"}
        message={isGM ? "O estado será salvo e a sessão ficará disponível apenas para histórico." : "Para voltar, você precisará do código novamente."}
        confirmLabel={isGM ? "Encerrar mesa" : "Sair da mesa"}
        onConfirm={() => void handleLeave()}
        onCancel={() => setLeaveDialogOpen(false)}
      />

      <ActionFeedback busy={busy} />

      <TurnStatus
        state={state}
        me={displayedCombatant}
        isGM={isGM}
        isControllingEnemy={isControllingEnemy}
      />

      <div className="player-mesa-grid player-mesa-grid-table player-mesa-hud-grid">
        <aside className="player-mesa-column player-mesa-left-rail" aria-label="Player status">
          <PlayerStatusPanel
            me={displayedCombatant}
            characterName={isControllingEnemy ? null : characterName}
            isGM={isGM}
            isControllingEnemy={isControllingEnemy}
          />
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
              onSelectTarget={(id) => {
                setSelectedAccessPointId(null);
                setSelectedHackableObjectId(null);
                if (isGM) setGmTargetDraft(id);
                else setTargetDraft(id);
              }}
             controlledCombatantId={isGM ? gmControlledCombatantId : null}
             selectedWeapon={isGM ? gmSelectedWeapon : playerSelectedWeapon}
             selectedAttackType={isGM ? gmSelectedWeapon?.attackType ?? gmSelectedAttack?.context.type : playerSelectedWeapon?.attackType ?? playerSelectedAttack?.context.type}
             selectedSkillId={isGM ? gmSelectedWeapon?.skill ?? gmSelectedAttack?.context.skillId : playerSelectedWeapon?.skill ?? playerSelectedAttack?.context.skillId}
              selectedHackableObjectId={selectedHackableObjectId}
              onSelectHackableObject={(id) => {
                setSelectedHackableObjectId(id);
                if (id) {
                  setSelectedAccessPointId(null);
                  setTargetDraft("");
                }
              }}
              selectedAccessPointId={selectedAccessPointId}
              onSelectAccessPoint={(id) => {
                setSelectedAccessPointId(id);
                if (id) {
                  setSelectedHackableObjectId(null);
                  setTargetDraft("");
                }
              }}
             gmMapToolsVisible={!isGM || gmControlMode === "map"}
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
           <PlayerNetrunnerPanel
             state={state}
             me={me}
              character={localCharacter}
              target={selectedAccessPointId || selectedHackableObjectId ? null : targets.find((target) => target.id === selectedTargetId) ?? null}
              selectedHackableObject={(state.session.tacticalMap?.hackableObjects ?? []).find((object) => object.id === selectedHackableObjectId) ?? null}
              selectedAccessPointId={selectedAccessPointId}
              onSelectAccessPoint={(id) => {
                setSelectedAccessPointId(id);
                if (id) {
                  setSelectedHackableObjectId(null);
                  setTargetDraft("");
                }
              }}
              busy={busy}
              run={run}
            />
           <GmNetArchitecturePanel state={state} />
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
               selectedWeaponId={selectedWeaponId}
               onSelectWeapon={setSelectedWeaponId}
               selectedAttackId={selectedAttackId}
               onSelectAttack={setSelectedAttackId}
               controlMode={gmControlMode}
               onControlModeChange={setGmControlMode}
             />
          ) : (
            <PlayerActionsPanel
              state={state}
              me={me}
              busy={busy}
              run={run}
              onChanged={onChanged}
               weapons={weapons}
               attacks={attacks}
              targets={targets}
              selectedTargetId={selectedTargetId}
               selectedWeaponId={selectedWeaponId}
               onSelectWeapon={setSelectedWeaponId}
               selectedAttackId={selectedAttackId}
               onSelectAttack={setSelectedAttackId}
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
