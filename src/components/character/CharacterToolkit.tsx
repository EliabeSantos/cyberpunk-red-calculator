"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import CharacterCreator from "@/components/character/CharacterCreator";
import CharacterSheet from "@/components/sheets/CharacterSheet";
import DiscordConsentPrompt from "@/components/discord/DiscordConsentPrompt";
import { getDiscordConsent, setDiscordConsent, type DiscordConsent } from "@/lib/discord/consent";
import { findNewRollEntry, notifyDiscordRoll } from "@/lib/discord/rollNotify";
import { getActiveCharacter, upsertCharacter } from "@/lib/storage";
import { maybePushSheet, applyMesaHealingItem, reloadMesa, registerMesaInitiative, rollMesaDeathSave } from "@/lib/mesa/client";
import { getMembershipSnapshot, getServerMembershipSnapshot, subscribeToMembership } from "@/lib/mesa/membershipStore";
import { useMesaState } from "@/lib/mesa/useMesaState";
import { activeMesaCandidate } from "@/lib/mesa/activeMesa";
import {
  linkedCombatant,
  playerAttackUnavailable as isPlayerAttackUnavailable,
  sheetMesaMode,
  trackedSupplyIds,
  type MesaInitiativeContext,
  type PlayerHealingSetup,
  type PlayerDeathSaveSetup,
} from "@/lib/mesa/sheetAuthority";
import type { PlayerAttackSetup } from "@/components/combat/AttackActions";
import { publishMesaHp } from "@/lib/mesa/hpPublish";
import { publishMesaRoll } from "@/lib/mesa/rollPublish";
import { syncMesaCharacterState } from "@/lib/mesa/characterSync";
import type { Character } from "@/types/character";

type Screen = "sheet" | "creator";

/**
 * A ficha é a tela principal do JOGADOR. A Mesa possui sua própria tela em
 * `/mesa/<uuid>`; o item de nav encaminha para ela depois da entrada.
 */
export default function CharacterToolkit() {
  const [character, setCharacter] = useState<Character | null>(null);
  const [screen, setScreen] = useState<Screen>("creator");
  const [ready, setReady] = useState(false);
  const [discordConsent, setDiscordConsentState] = useState<DiscordConsent | null>(null);
  const memberships = useSyncExternalStore(subscribeToMembership, getMembershipSnapshot, getServerMembershipSnapshot);
  // F1.12.7 — mesma detecção de "Mesa ativa" do botão "Mesa": candidata do
  // `membershipStore` validada (uuid) antes de virar estado.
  const activeMembership = activeMesaCandidate(memberships);
  const mesa = useMesaState(activeMembership?.sessionId ?? null);
  /**
   * F1.14.2 — trava de repetição do Player Initiative Gateway: um registro por
   * vez. Ref (não estado) para não depender do re-render chegar a tempo.
   */
  const initiativeBusyRef = useRef(false);
  const deathSaveBusyRef = useRef(false);
  /**
   * F1.13.4/F1.13.5 — modo de operação da ficha. `"mesa-combat"` (Mesa como
   * autoridade) só quando dá para afirmar com segurança: sessão viva, olhando
   * como jogador, combate `active` e ESTE personagem dentro. Qualquer dúvida →
   * `"local"`, ou seja, o comportamento da ficha de sempre.
   *
   * **Fonte única (F1.13.5):** tudo que na ficha precisa saber "estou em
   * combate Mesa?" lê daqui — nada aqui embaixo reconta `viewer.role`,
   * `combat.status` ou a vinculação.
   */
  const sheetMode = sheetMesaMode({ state: mesa.state, characterId: character?.id ?? null });
  const mesaCombatActive = sheetMode === "mesa-combat";

  /**
   * F1.13.5 — contexto de ataque da Mesa. A detecção NÃO é refeita: ele só
   * existe quando o modo acima é `"mesa-combat"` e, dentro dele, `actor` é a
   * leitura de qual combatente é ESTE personagem (`linkedCombatant`). Fora do
   * modo → `undefined` → ataque local de sempre.
   */
  const playerAttack = useMemo<PlayerAttackSetup | undefined>(() => {
    const state = mesa.state;
    if (!mesaCombatActive || !character || !state) return undefined;
    const actor = linkedCombatant(state, character.id);
    if (!actor) return undefined;
    return {
      sessionId: state.session.id,
      actorId: actor.id,
       targets: state.combatants.filter((combatant) => combatant.kind !== "net_ice").map((combatant) => ({
        id: combatant.id,
        name: combatant.name,
         kind: combatant.kind as "character" | "enemy",
        isDead: combatant.isDead,
      })),
      onRefresh: mesa.refresh,
    };
  }, [character, mesa.refresh, mesa.state, mesaCombatActive]);
  /**
   * F1.13.5 — o bloqueio "Combate da Mesa indisponível" é um desdobramento do
   * MESMO modo central: `true` só em `"mesa-combat"` sem contexto de ataque da
   * Mesa. A checagem paralela antiga (`viewer.role === "player" &&
   * combat.status === "active" && !playerAttack`) foi removida.
   */
  const playerAttackUnavailable = isPlayerAttackUnavailable({
    state: mesa.state,
    characterId: character?.id ?? null,
    hasAttackSetup: playerAttack !== undefined,
  });
  // Leitura direta do orçamento da Mesa para o campo "Movido (m)" da ficha.
  // Não persiste uma segunda cópia em Character nem altera turnState local.
  const movementCombatant = mesaCombatActive && character
    ? linkedCombatant(mesa.state, character.id) : null;
  const mesaMovement = movementCombatant
    ? { max: movementCombatant.movementMax, remaining: movementCombatant.movementRemaining }
    : undefined;

  /**
   * F1.13.4 — contexto do **item de cura** durante o combate da Mesa.
   *
   * Presente ⇔ `sheetMesaMode === "mesa-combat"`: a ficha manda a intenção para
   * `POST /combat/item-heal` e espera o servidor. `onUpdate` NUNCA entra aqui —
   * o estado novo volta pelo mesmo `refresh` que alimenta
   * `syncMesaCharacterState`.
   */
  const playerHealing = useMemo<PlayerHealingSetup | undefined>(() => {
    const state = mesa.state;
    // Desmembrado: chamar `mesa.refresh()` dentro do memo faria o lint pedir o
    // objeto inteiro como dependência (identidade nova a cada render).
    const refresh = mesa.refresh;
    if (!mesaCombatActive || !character || !state) return undefined;
    const actor = linkedCombatant(state, character.id);
    if (!actor) return undefined;
    const tracked = trackedSupplyIds(actor);
    return {
      isTracked: (itemId) => tracked.has(itemId),
      useItem: async (itemId) => {
        const result = await applyMesaHealingItem({
          sessionId: state.session.id,
          actorCombatantId: actor.id,
          itemId,
        });
        // Realtime/polling existente: a ficha recebe o resultado sincronizado
        // por aqui, não por escrita local. Falha de refresh não desfaz o cura
        // (já commitado) — o polling recupera.
        await refresh().catch(() => undefined);
        return result;
      },
    };
  }, [character, mesa.refresh, mesa.state, mesaCombatActive]);

  // Reload já possui gateway. Em mesa-combat a ficha só envia a intenção e
  // espera o refresh; nenhum valor de munição/ação é aplicado localmente como
  // atalho visual.
  const playerReload = useMemo(() => {
    if (sheetMode !== "mesa-combat" || !mesa.state) return undefined;
    const sessionId = mesa.state.session.id;
    const refresh = mesa.refresh;
    return {
      reloadWeapon: async (weaponId: string) => {
        await reloadMesa({ sessionId, weaponId });
        await refresh().catch(() => undefined);
      },
    };
  }, [mesa.refresh, mesa.state, sheetMode]);

  /**
   * F1.14.2 — contexto do **Player Initiative Gateway** durante o combate da Mesa.
   *
   * Presente ⇔ `sheetMesaMode === "mesa-combat"`: a ficha rola localmente (o RNG
   * continua sendo o dela), manda SÓ a intenção para `POST /combat/initiative`
   * e espera o servidor. `onUpdate` NUNCA entra aqui — o valor exibido vem do
   * estado da Mesa (`syncMesaCharacterState` → `character.combat.initiative`).
   *
   * O `busy` vive num ref daqui (e não em estado da ficha): dois cliques
   * rápidos não geram dois POSTs, mesmo que o re-render chegue atrasado.
   */
  const playerInitiative = useMemo<MesaInitiativeContext | undefined>(() => {
    const state = mesa.state;
    const refresh = mesa.refresh;
    if (!mesaCombatActive || !character || !state) return undefined;
    const actor = linkedCombatant(state, character.id);
    if (!actor) return undefined;
    const sessionId = state.session.id;
    const busy = initiativeBusyRef;
    return {
      isBusy: () => busy.current,
      setBusy: (value) => { busy.current = value; },
      combatantId: actor.id,
      register: (intent) => registerMesaInitiative({ sessionId, ...intent }),
      // Realtime/polling existente: o valor chega por aqui, não por escrita local.
      refresh: () => refresh().catch(() => undefined),
    };
  }, [character, mesa.refresh, mesa.state, mesaCombatActive]);

  const playerDeathSave = useMemo<PlayerDeathSaveSetup | undefined>(() => {
    const state = mesa.state;
    if (!mesaCombatActive || !character || !state) return undefined;
    const actor = linkedCombatant(state, character.id);
    if (!actor) return undefined;
    return {
      isBusy: () => deathSaveBusyRef.current,
      setBusy: (value) => { deathSaveBusyRef.current = value; },
      roll: async () => {
        const result = await rollMesaDeathSave({ sessionId: state.session.id, actorCombatantId: actor.id });
        await mesa.refresh().catch(() => undefined);
        return result;
      },
    };
  }, [character, mesa.refresh, mesa.state, mesaCombatActive]);

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
    if (!character || !mesa.state || sheetMode !== "mesa-combat") return;
    const synchronized = syncMesaCharacterState(character, mesa.state);
    if (synchronized === character) return;
    upsertCharacter(synchronized);
    setCharacter(synchronized);
  }, [character, mesa.state, sheetMode]);

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

  if (!ready) {
    return <main className="loading-screen">Carregando ficha...</main>;
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
        playerHealing={playerHealing}
        playerInitiative={playerInitiative}
        playerDeathSave={playerDeathSave}
        mesaMovement={mesaMovement}
        sheetMesaMode={sheetMode}
        playerReload={playerReload}
        onEdit={() => setScreen("creator")}
        onNewCharacter={() => { setCharacter(null); setScreen("creator"); }}
      />
    ) : null;

  return (
    <>
      {discordConsent === null && <DiscordConsentPrompt onDecide={handleDiscordConsent} />}
      {content}
    </>
  );
}
