"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";

import { attackMesa, MesaApiError, reloadMesa } from "@/lib/mesa/client";
import { loadCharacters } from "@/lib/storage";
import {
  getMembershipSnapshot,
  getServerMembershipSnapshot,
  subscribeToMembership,
} from "@/lib/mesa/membershipStore";
import { useMesaState } from "@/lib/mesa/useMesaState";
import type { MesaCombatant, MesaEvent, MesaState } from "@/lib/mesa/types";
import type { AttackResult, DamageResult } from "@/lib/combat/contract";

interface Props {
  sessionId: string;
}

type AttackMode = "normal" | "aimed";

interface AttackFeedback {
  attackResult: AttackResult;
  damageResult?: DamageResult;
  weaponDamage?: { total?: number; expression?: string; rolls?: number[] };
  damageError?: { message: string };
}

function errorText(error: string | null, code: string | null): string {
  if (code === "not_participant") return "Você não está nesta Mesa.";
  if (code === "session_not_found") return "Mesa não encontrada.";
  if (code === "session_finished") return "Esta Mesa foi encerrada.";
  return error ?? "Não foi possível carregar a Mesa.";
}

function activeCharacterFor(combatant: MesaCombatant | null) {
  if (!combatant?.characterId) return null;
  return loadCharacters().find((character) => character.id === combatant.characterId) ?? null;
}

export default function PlayerMesaView({ sessionId }: Props) {
  const memberships = useSyncExternalStore(
    subscribeToMembership,
    getMembershipSnapshot,
    getServerMembershipSnapshot,
  );
  const membership = Object.values(memberships.entries).find((entry) => entry.sessionId === sessionId) ?? null;
  const { state, loading, error, errorCode, realtime, refresh } = useMesaState(membership ? sessionId : null);

  if (!membership) {
    return <PlayerStateShell title="Mesa" message="Você não está nesta Mesa." />;
  }
  if (loading && !state) {
    return <PlayerStateShell title="Mesa" message="Carregando Mesa..." />;
  }
  if (error && !state) {
    return <PlayerStateShell title="Mesa" message={errorText(error, errorCode)} retry={() => void refresh()} />;
  }
  if (!state) {
    return <PlayerStateShell title="Mesa" message="Não foi possível carregar a Mesa." retry={() => void refresh()} />;
  }

  return <PlayerState state={state} realtime={realtime} onRefresh={refresh} />;
}

function PlayerStateShell({ title, message, retry }: { title: string; message: string; retry?: () => void }) {
  return (
    <main className="player-mesa-page">
      <section className="player-mesa-panel player-mesa-state">
        <span className="mesa-eyebrow">MESA</span>
        <h1>{title}</h1>
        <p className="mesa-hint">{message}</p>
        <div className="player-mesa-state-actions">
          {retry && <button type="button" className="mesa-secondary" onClick={retry}>Tentar novamente</button>}
          <Link className="mesa-ghost" href="/">Voltar para a ficha</Link>
        </div>
      </section>
    </main>
  );
}

function PlayerState({
  state,
  realtime,
  onRefresh,
}: {
  state: MesaState;
  realtime: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [targetId, setTargetId] = useState("");
  const [weaponId, setWeaponId] = useState("");
  const [attackMode, setAttackMode] = useState<AttackMode>("aimed");
  const [aimedTarget, setAimedTarget] = useState<"head" | "leg" | "held_item">("head");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<AttackFeedback | null>(null);
  const [attackError, setAttackError] = useState<string | null>(null);
  const [reloadingWeaponId, setReloadingWeaponId] = useState<string | null>(null);
  const [reloadFeedback, setReloadFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const reloadInFlight = useRef(new Set<string>());

  const me = state.combatants.find((combatant) => combatant.participantId === state.viewer.participantId) ?? null;
  const character = activeCharacterFor(me);
  const weapons = character?.weapons ?? [];
  const targets = state.combatants.filter((combatant) => combatant.kind === "enemy" && !combatant.isDead);
  const active = state.combat?.activeCombatantId
    ? state.combatants.find((combatant) => combatant.id === state.combat?.activeCombatantId) ?? null
    : null;
  const myTurn = Boolean(active && active.id === me?.id);

  const selectedTarget = targets.some((target) => target.id === targetId) ? targetId : targets[0]?.id ?? "";
  const selectedWeapon = weapons.find((weapon) => weapon.id === weaponId) ?? weapons[0];
  const noActions = Boolean(me && me.actionsRemaining <= 0);
  const selectedWeaponAmmo = selectedWeapon?.id ? me?.ammoByWeapon?.[selectedWeapon.id] : undefined;
  const selectedWeaponHasMagazine = typeof selectedWeapon?.magazine === "number" && selectedWeapon.magazine > 0;
  const selectedWeaponOutOfAmmo = selectedWeaponHasMagazine && selectedWeaponAmmo !== undefined && selectedWeaponAmmo <= 0;
  const selectedWeaponAmmoUnavailable = selectedWeaponHasMagazine && selectedWeaponAmmo === undefined;

  function canAttemptReload(weapon: (typeof weapons)[number]): boolean {
    const ammo = weapon.id ? me?.ammoByWeapon?.[weapon.id] : undefined;
    return Boolean(
      state.combat?.status === "active"
      && me
      && myTurn
      && !me.isDead
      && me.actionsRemaining > 0
      && typeof weapon.id === "string"
      && typeof weapon.magazine === "number"
      && weapon.magazine > 0
      && typeof ammo === "number"
      && ammo < weapon.magazine,
    );
  }

  async function submitReload(nextWeaponId: string) {
    if (!me || reloadInFlight.current.has(nextWeaponId) || reloadingWeaponId) return;
    const weapon = weapons.find((candidate) => candidate.id === nextWeaponId);
    if (!weapon || !canAttemptReload(weapon)) return;

    reloadInFlight.current.add(nextWeaponId);
    setReloadingWeaponId(nextWeaponId);
    setReloadFeedback(null);
    try {
      await reloadMesa({
        sessionId: state.session.id,
        weaponId: nextWeaponId,
        resolutionId: crypto.randomUUID(),
      });
      setReloadFeedback({ kind: "success", message: "Recarga concluída. Estado da Mesa atualizado." });
      void onRefresh().catch(() => undefined);
    } catch (caught) {
      setReloadFeedback({
        kind: "error",
        message: caught instanceof MesaApiError ? caught.message : "Não foi possível recarregar a arma.",
      });
      void onRefresh().catch(() => undefined);
    } finally {
      reloadInFlight.current.delete(nextWeaponId);
      setReloadingWeaponId(null);
    }
  }

  async function submitAttack() {
    if (!me || !selectedTarget || !selectedWeapon || busy) return;
    setBusy(true);
    setAttackError(null);
    try {
      const result = await attackMesa({
        sessionId: state.session.id,
        resolutionId: crypto.randomUUID(),
        actorId: me.id,
        targetId: selectedTarget,
        weaponId: selectedWeapon.id,
        skillId: selectedWeapon.skill,
        attackType: selectedWeapon.attackType,
        attackMode,
        ...(attackMode === "aimed" ? { aimedTarget } : {}),
      });
      setFeedback(result);
      await onRefresh();
    } catch (caught) {
      setAttackError(caught instanceof MesaApiError ? caught.message : "Falha no ataque.");
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="player-mesa-page">
      <header className="player-mesa-header">
        <div>
          <span className="mesa-eyebrow">MESA ONLINE</span>
          <h1>{state.session.name}</h1>
          <p className="player-mesa-subtitle">{state.viewer.displayName ?? "Jogador"}</p>
        </div>
        <div className="player-mesa-header-meta">
          <span className={`mesa-badge ${state.session.status === "active" ? "is-live" : ""}`}>
            {state.session.status === "finished" ? "ENCERRADA" : state.session.status.toUpperCase()}
          </span>
          <span className={`mesa-badge ${realtime ? "is-live" : ""}`}>{realtime ? "● AO VIVO" : "◌ SINCRONIZANDO"}</span>
          <Link className="mesa-ghost" href="/">Ficha</Link>
        </div>
      </header>

      {state.session.status === "finished" && <p className="player-mesa-notice">Esta Mesa foi encerrada.</p>}

      <div className="player-mesa-grid">
        <section className="player-mesa-panel player-mesa-character">
          <div className="player-mesa-section-heading">
            <span className="mesa-eyebrow">SEU PERSONAGEM</span>
            <strong>{me?.name ?? "Sem personagem vinculado"}</strong>
          </div>
          {me ? (
            <>
              <div className="player-mesa-stat-grid">
                <Stat label="HP" value={`${me.hpCurrent}/${me.hpMax}`} />
                <Stat label="ARMOR" value={armorText(character, aimedTarget)} />
                <Stat label="AÇÕES" value={`${me.actionsRemaining}/${me.actionsMax}`} />
                <Stat label="TURNO" value={myTurn ? "SEU" : active?.name ?? "—"} />
              </div>
              <p className={me.isDead ? "player-mesa-defeated" : "player-mesa-alive"}>{me.isDead ? "DERROTADO" : "ATIVO"}</p>
            </>
          ) : (
            <p className="mesa-hint">Vincule uma ficha pelo convite da Mesa antes de jogar.</p>
          )}
        </section>

        <section className="player-mesa-panel player-mesa-combat-summary">
          <div className="player-mesa-section-heading">
            <span className="mesa-eyebrow">COMBATE</span>
            <strong>{state.combat ? `Rodada ${state.combat.round}` : "Aguardando combate"}</strong>
          </div>
          {state.combat ? (
            <>
              <p className="player-mesa-turn">Ativo: <b>{active?.name ?? "—"}</b></p>
              <p className="mesa-hint">{state.combat.initiativeStarted ? "Iniciativa em andamento" : "Aguardando iniciativa do Mestre"}</p>
            </>
          ) : <p className="mesa-hint">Aguardando o Mestre iniciar o combate.</p>}
        </section>
      </div>

      {state.combat?.status === "active" && (
        me && <section className="player-mesa-panel player-mesa-weapons">
          <div className="player-mesa-section-heading">
            <span className="mesa-eyebrow">EQUIPAMENTO</span>
            <strong>Armas</strong>
          </div>
          {!myTurn && <p className="mesa-hint">Aguarde o seu turno para recarregar.</p>}
          {noActions && myTurn && <p className="mesa-hint">Sem Actions restantes neste turno.</p>}
          <div className="player-mesa-weapon-list">
            {weapons.length === 0 ? <p className="mesa-hint">Nenhuma arma vinculada disponível.</p> : weapons.map((weapon) => {
              const ammo = weapon.id ? me.ammoByWeapon?.[weapon.id] : undefined;
              const hasMagazine = typeof weapon.magazine === "number" && weapon.magazine > 0;
              const unavailable = hasMagazine && typeof ammo !== "number";
              const full = hasMagazine && typeof ammo === "number" && ammo >= (weapon.magazine ?? 0);
              const disabled = Boolean(
                reloadingWeaponId
                || !canAttemptReload(weapon)
                || unavailable
                || full,
              );
              return <article className="player-mesa-weapon-card" key={weapon.id}>
                <div className="player-mesa-weapon-heading">
                  <strong>{weapon.name}</strong>
                  {typeof weapon.rateOfFire === "number" && <span>ROF {weapon.rateOfFire}</span>}
                </div>
                <div className="player-mesa-weapon-details">
                  <span>{hasMagazine ? (typeof ammo === "number" ? `${ammo}/${weapon.magazine ?? 0}` : "—/—") : "Sem magazine"}</span>
                  <small>{hasMagazine ? "munição server-side" : "arma sem recarga"}</small>
                </div>
                {hasMagazine && <button
                  type="button"
                  className="mesa-secondary player-mesa-reload"
                  onClick={() => void submitReload(weapon.id)}
                  disabled={disabled}
                  title={unavailable ? "Munição server-side indisponível" : full ? "Carregador cheio" : undefined}
                >
                  {reloadingWeaponId === weapon.id ? "Recarregando..." : full ? "Carregador cheio" : unavailable ? "Munição indisponível" : "Recarregar"}
                </button>}
              </article>;
            })}
          </div>
          {reloadFeedback && <p className={`player-mesa-reload-feedback ${reloadFeedback.kind}`}>{reloadFeedback.message}</p>}
        </section>
      )}

      {state.combat?.status === "active" && (
        <section className="player-mesa-panel player-mesa-attack">
          <div className="player-mesa-section-heading">
            <span className="mesa-eyebrow">AÇÃO DO PLAYER</span>
            <strong>Atacar</strong>
          </div>
          {!myTurn ? <p className="mesa-hint">Aguarde o seu turno para atacar.</p> : me?.isDead ? <p className="mesa-hint">Seu personagem está derrotado.</p> : (
            <>
            {noActions && <p className="mesa-hint">Sem Actions restantes neste turno.</p>}
            <div className="player-mesa-attack-form">
              <label>Alvo<select value={selectedTarget} onChange={(event) => setTargetId(event.target.value)} disabled={busy || targets.length === 0}>
                {targets.length === 0 ? <option value="">Nenhum inimigo disponível</option> : targets.map((target) => <option key={target.id} value={target.id}>{target.name} · {target.hpCurrent}/{target.hpMax} HP</option>)}
              </select></label>
              <label>Arma<select value={selectedWeapon?.id ?? ""} onChange={(event) => setWeaponId(event.target.value)} disabled={busy || weapons.length === 0}>
                {weapons.length === 0 ? <option value="">Nenhuma arma vinculada disponível</option> : weapons.map((weapon) => <option key={weapon.id} value={weapon.id}>{weapon.name}</option>)}
              </select>
                {selectedWeapon && (
                  <small className="player-mesa-weapon-ammo">
                    {selectedWeaponHasMagazine
                      ? selectedWeaponAmmo === undefined
                        ? "Munição indisponível"
                        : `Munição ${selectedWeaponAmmo}/${selectedWeapon.magazine}`
                      : "Sem magazine"}
                    {typeof selectedWeapon.rateOfFire === "number" ? ` · ROF ${selectedWeapon.rateOfFire}` : ""}
                  </small>
                )}
              </label>
              <label>Modo<select value={attackMode} onChange={(event) => setAttackMode(event.target.value as AttackMode)} disabled={busy}>
                <option value="aimed">Aimed</option>
                <option value="normal">Normal</option>
              </select></label>
               {attackMode === "aimed" && <label>Local<select value={aimedTarget} onChange={(event) => setAimedTarget(event.target.value as "head" | "leg" | "held_item")} disabled={busy}>
                 <option value="head">Head</option>
                 <option value="leg">Leg</option>
                 <option value="held_item">Held Item</option>
              </select></label>}
              <button type="button" className="mesa-primary" onClick={() => void submitAttack()} disabled={busy || noActions || !selectedTarget || !selectedWeapon || selectedWeaponOutOfAmmo || selectedWeaponAmmoUnavailable}>
                {busy ? "Resolvendo..." : selectedWeaponOutOfAmmo ? "[ SEM MUNIÇÃO ]" : "[ ATACAR ]"}
              </button>
            </div>
            </>
          )}
          {attackError && <p className="player-mesa-error">{attackError}</p>}
          {feedback && <AttackFeedbackView feedback={feedback} />}
        </section>
      )}

      <section className="player-mesa-panel">
        <div className="player-mesa-section-heading"><span className="mesa-eyebrow">COMBATANTS</span><strong>Estado da Mesa</strong></div>
        <ul className="player-mesa-combatants">{state.combatants.map((combatant) => <CombatantRow key={combatant.id} combatant={combatant} selected={combatant.id === selectedTarget} onSelect={combatant.kind === "enemy" && !combatant.isDead ? setTargetId : undefined} />)}</ul>
      </section>

      <Events events={state.combat?.eventLog ?? []} />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="player-mesa-stat"><span>{label}</span><b>{value}</b></div>;
}

function armorText(character: ReturnType<typeof activeCharacterFor>, location: "head" | "leg" | "held_item"): string {
  // A MesaState não expõe Armor mutável. A ficha vinculada fornece apenas a
  // referência visual; nenhuma decisão de dano usa este valor no cliente.
  const armor = character?.combat.armor[location === "head" ? "head" : "body"];
  return typeof armor === "number" ? `${armor} SP` : "—";
}

function CombatantRow({ combatant, selected, onSelect }: { combatant: MesaCombatant; selected: boolean; onSelect?: (id: string) => void }) {
  const content = <><span className="player-mesa-combatant-name"><b>{combatant.name}</b><small>{combatant.kind === "enemy" ? "Inimigo" : "Personagem"}</small></span><span>{combatant.hpCurrent}/{combatant.hpMax} HP</span><span>{combatant.isDead ? "DERROTADO" : `${combatant.actionsRemaining} ações`}</span></>;
  return <li className={`${combatant.isDead ? "is-dead" : ""}${selected ? " is-selected" : ""}`}>{onSelect ? <button type="button" onClick={() => onSelect(combatant.id)}>{content}</button> : <div>{content}</div>}</li>;
}

function AttackFeedbackView({ feedback }: { feedback: AttackFeedback }) {
  const attack = feedback.attackResult;
  const damage = feedback.damageResult;
  return <div className="player-mesa-feedback"><strong>{attack.hit ? "HIT" : "MISS"}</strong><span>Ataque: {attack.total} · Defesa: {attack.defenseValue}</span>{damage && <span>Dano: {damage.rawDamage} · Armor: {damage.armorValue} · Final: {damage.damageAfterArmor} · HP: {damage.hpBefore} → {damage.hpAfter}</span>}{feedback.damageError && <span>{feedback.damageError.message}</span>}</div>;
}

function Events({ events }: { events: MesaEvent[] }) {
  const recent = events.slice(-8).reverse();
  return <section className="player-mesa-panel player-mesa-events"><div className="player-mesa-section-heading"><span className="mesa-eyebrow">EVENTOS</span><strong>Registro recente</strong></div>{recent.length === 0 ? <p className="mesa-hint">Nenhum evento ainda.</p> : <ul>{recent.map((event, index) => <li key={`${event.at}-${index}`}><time>{new Date(event.at).toLocaleTimeString("pt-BR")}</time>{event.text}</li>)}</ul>}</section>;
}
