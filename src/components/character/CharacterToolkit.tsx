"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import CharacterCreator from "@/components/character/CharacterCreator";
import CharacterSheet from "@/components/sheets/CharacterSheet";
import DiscordConsentPrompt from "@/components/discord/DiscordConsentPrompt";
import MesaRoomDock from "@/components/mesa/MesaRoomDock";
import { getDiscordConsent, setDiscordConsent, type DiscordConsent } from "@/lib/discord/consent";
import { findNewRollEntry, notifyDiscordRoll } from "@/lib/discord/rollNotify";
import { getActiveCharacter, upsertCharacter } from "@/lib/storage";
import { maybePushSheet } from "@/lib/mesa/client";
import { getMembershipSnapshot, getServerMembershipSnapshot, subscribeToMembership } from "@/lib/mesa/membershipStore";
import { useMesaState } from "@/lib/mesa/useMesaState";
import type { PlayerAttackSetup } from "@/components/combat/AttackActions";
import { publishMesaHp } from "@/lib/mesa/hpPublish";
import { publishMesaRoll } from "@/lib/mesa/rollPublish";
import { syncMesaCharacterState } from "@/lib/mesa/characterSync";
import type { Character } from "@/types/character";

type Screen = "sheet" | "creator";

interface Props {
  /**
   * Código de convite vindo de /mesa/CODE. É a MESMA tela da ficha — só abre o
   * painel da mesa por cima, para o jogador não ser tirado da sessão principal.
   */
  initialJoinCode?: string;
}

export default function CharacterToolkit({ initialJoinCode }: Props) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [screen, setScreen] = useState<Screen>("creator");
  const [ready, setReady] = useState(false);
  const [discordConsent, setDiscordConsentState] = useState<DiscordConsent | null>(null);
  const memberships = useSyncExternalStore(subscribeToMembership, getMembershipSnapshot, getServerMembershipSnapshot);
  const activeMembership = memberships.activeJoinCode ? memberships.entries[memberships.activeJoinCode] ?? null : null;
  const mesa = useMesaState(activeMembership?.sessionId ?? null);
  const mesaCombatActive = Boolean(
    mesa.state?.combat?.status === "active" &&
    character &&
    mesa.state.combatants.some(
      (entry) => entry.characterId === character.id && entry.participantId === mesa.state?.viewer.participantId,
    ),
  );

  const playerAttack = useMemo<PlayerAttackSetup | undefined>(() => {
    const state = mesa.state;
    if (!character || !state || state.viewer.role !== "player" || !state.combat || state.combat.status !== "active") return undefined;
    const actor = state.combatants.find(
      (combatant) => combatant.participantId === state.viewer.participantId && combatant.kind === "character" && combatant.characterId === character.id,
    );
    if (!actor) return undefined;
    return {
      sessionId: state.session.id,
      actorId: actor.id,
      targets: state.combatants.map((combatant) => ({
        id: combatant.id,
        name: combatant.name,
        kind: combatant.kind,
        isDead: combatant.isDead,
      })),
      onRefresh: mesa.refresh,
    };
  }, [character, mesa.refresh, mesa.state]);
  const playerAttackUnavailable = Boolean(
    character &&
      mesa.state?.viewer.role === "player" &&
      mesa.state.combat?.status === "active" &&
      !playerAttack,
  );

  useEffect(() => {
    const savedCharacter = getActiveCharacter();
    setCharacter(savedCharacter);
    setScreen(savedCharacter ? "sheet" : "creator");
    setDiscordConsentState(getDiscordConsent());
    setReady(true);
  }, []);

  // O snapshot já foi validado pelo servidor. Esta convergência local não usa
  // handleUpdate, portanto não gera um POST de retorno nem loop de espelho.
  useEffect(() => {
    if (!character || !mesa.state) return;
    const synchronized = syncMesaCharacterState(character, mesa.state);
    if (synchronized === character) return;
    upsertCharacter(synchronized);
    setCharacter(synchronized);
  }, [character, mesa.state]);

  function handleDiscordConsent(consent: DiscordConsent) {
    setDiscordConsent(consent);
    setDiscordConsentState(consent);
  }

  function handleUpdate(updated: Character) {
    const next = mesaCombatActive && mesa.state
      ? syncMesaCharacterState(updated, mesa.state)
      : updated;
    const newRoll = findNewRollEntry(character, next);
    if (newRoll) notifyDiscordRoll(newRoll, next);
    publishMesaRoll(newRoll);
    if (!mesaCombatActive) publishMesaHp(character, next);
    upsertCharacter(next);
    setCharacter(next);
    if (!mesaCombatActive) void maybePushSheet(next);
  }

  // O painel da mesa renderiza mesmo durante o carregamento: quem chega pelo
  // link de convite não precisa esperar a ficha para ver a sala.
  if (!ready) {
    return (
      <>
        <main className="loading-screen">Carregando ficha...</main>
        <MesaRoomDock initialJoinCode={initialJoinCode} />
      </>
    );
  }

  const content =
    screen === "creator" ? (
      <CharacterCreator
        initialCharacter={character ?? undefined}
        onSaved={(saved) => {
          // Editar a ficha também muda vida (HP máximo, morte): espelha igual ao
          // caminho normal, sem depender de nenhuma outra parte do salvamento.
           const next = mesaCombatActive && mesa.state
             ? syncMesaCharacterState(saved, mesa.state)
             : saved;
           if (!mesaCombatActive) publishMesaHp(character, next);
           upsertCharacter(next);
           setCharacter(next);
          setScreen("sheet");
        }}
      />
    ) : character ? (
      <CharacterSheet
        character={character}
        discordConsent={discordConsent}
        onDiscordConsentChange={handleDiscordConsent}
        onUpdate={handleUpdate}
        playerAttack={playerAttack}
        playerAttackUnavailable={playerAttackUnavailable}
        onEdit={() => setScreen("creator")}
        onNewCharacter={() => { setCharacter(null); setScreen("creator"); }}
      />
    ) : null;

  return (
    <>
      {discordConsent === null && <DiscordConsentPrompt onDecide={handleDiscordConsent} />}
      {content}
      <MesaRoomDock initialJoinCode={initialJoinCode} />
    </>
  );
}
