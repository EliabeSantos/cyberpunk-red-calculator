"use client";

/**
 * F1.12.3 — o que o Player PODE FAZER agora: atacar e usar as ações de turno.
 *
 * Reutiliza os endpoints server-authoritative já existentes
 * (`POST /combat/attack`, `/combat/action`, `/combat/turn`) e o `resolveAction`
 * do Combat Engine só para DESABILITAR botões (`evaluateMesaAction`).
 * Nenhuma rolagem roda no cliente; nenhum HP/dano/resultado sai daqui como
 * autoridade — a UI apenas manda a INTENÇÃO e desenha o estado devolvido.
 */

import { useRef, useState } from "react";

import { attackMesa, moveMesa } from "@/lib/mesa/client";
import { evaluateMesaAction } from "@/lib/mesa/actionGate";
import { findCombatant } from "@/lib/mesa/playerScreen";
import type { Character } from "@/types/character";
import type { MesaCombatant } from "@/lib/mesa/types";
import type { PlayerPanelBase } from "./types";

type AttackMode = "normal" | "aimed";
type AimedLocation = "head" | "leg" | "held_item";

/** O que o servidor devolve para um ataque — nunca recalculado aqui. */
type AttackFeedback = Awaited<ReturnType<typeof attackMesa>>;

interface Props extends PlayerPanelBase {
  weapons: Character["weapons"];
  /** Inimigos vivos — é deles que sai o alvo do ataque. */
  targets: MesaCombatant[];
  selectedTargetId: string;
  onSelectTarget: (combatantId: string) => void;
  sessionFinished: boolean;
}

export default function PlayerActionsPanel({
  state,
  me,
  busy,
  run,
  weapons,
  targets,
  selectedTargetId,
  onSelectTarget,
  sessionFinished,
}: Props) {
  const [weaponId, setWeaponId] = useState("");
  const [attackMode, setAttackMode] = useState<AttackMode>("aimed");
  const [aimedTarget, setAimedTarget] = useState<AimedLocation>("head");
  const [moveDraft, setMoveDraft] = useState("");
  const movePending = useRef(false);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<AttackFeedback | null>(null);
  const [attackError, setAttackError] = useState<string | null>(null);

  const combat = state.combat;
  const combatActive = combat?.status === "active" && !sessionFinished;
  const initiativeReady = Boolean(combat?.initiativeStarted);
  const active = findCombatant(state, combat?.activeCombatantId ?? null);
  const myTurn = Boolean(active && me && active.id === me.id);

  const selectedWeapon = weapons.find((weapon) => weapon.id === weaponId) ?? weapons[0] ?? null;
  const ammo = selectedWeapon?.id ? me?.ammoByWeapon?.[selectedWeapon.id] : undefined;
  const hasMagazine = typeof selectedWeapon?.magazine === "number" && selectedWeapon.magazine > 0;
  const outOfAmmo = hasMagazine && ammo !== undefined && ammo <= 0;
  const ammoUnavailable = hasMagazine && ammo === undefined;

  const moveMeters = (() => {
    const value = Number(moveDraft);
    return Number.isSafeInteger(value) && value > 0 && moveDraft.trim() !== "" ? value : 0;
  })();

  // Os MESMOS checks do servidor — só para desenhar o botão desabilitado.
  const moveGate = me ? evaluateMesaAction({ state, combatant: me, actionType: "move", meters: moveMeters }) : null;

  async function submitAttack() {
    if (!me || !selectedTargetId || !selectedWeapon || busy) return;
    setFeedback(null);
    setAttackError(null);
    await run(
      async () => {
        const result = await attackMesa({
          sessionId: state.session.id,
          resolutionId: crypto.randomUUID(),
          actorId: me.id,
          targetId: selectedTargetId,
          weaponId: selectedWeapon.id,
          skillId: selectedWeapon.skill,
          attackType: selectedWeapon.attackType,
          attackMode,
          ...(attackMode === "aimed" ? { aimedTarget } : {}),
        });
        setFeedback(result);
      },
      {
        onError: (message) => {
          setAttackError(message);
          setFeedback(null);
        },
      },
    );
  }

  if (!combatActive) {
    return (
      <section className="player-mesa-panel player-mesa-actions">
        <div className="player-mesa-section-heading">
          <span className="mesa-eyebrow">AÇÕES</span>
          <strong>Combate parado</strong>
        </div>
        <p className="mesa-hint">
          {sessionFinished
            ? "Esta Mesa foi encerrada — não há mais ações disponíveis."
            : combat?.status === "finished"
              ? "O combate anterior terminou. Aguardando o Mestre iniciar o próximo."
              : "Aguardando o Mestre iniciar o combate. Os controles aparecem aqui assim que ele começar."}
        </p>
      </section>
    );
  }

  return (
    <section className="player-mesa-panel player-mesa-actions">
      <div className="player-mesa-section-heading">
        <span className="mesa-eyebrow">AÇÃO DO PLAYER</span>
        <strong>{myTurn ? "Sua vez" : "Aguardando"}</strong>
      </div>

      {!initiativeReady && <p className="mesa-hint">Aguardando o Mestre rolar a iniciativa.</p>}
      {initiativeReady && !myTurn && (
        <p className="mesa-hint">
          {me ? `Aguarde o seu turno — ${active?.name ?? "outro combatente"} está agindo.` : "Vincule uma ficha para agir."}
        </p>
      )}
      {myTurn && me?.isDead && <p className="mesa-hint">Seu personagem está derrotado e não age mais.</p>}
      {myTurn && me && !me.isDead && me.actionsRemaining <= 0 && (
        <p className="mesa-hint">Sem Actions restantes — finalize o turno.</p>
      )}

      {/* --- Seleção de alvo + ataque ------------------------------------- */}
      <div className="player-mesa-attack-form">
        <label>
          Alvo
          <select
            value={selectedTargetId}
            disabled={busy || targets.length === 0}
            onChange={(event) => onSelectTarget(event.target.value)}
          >
            {targets.length === 0 ? (
              <option value="">Nenhum inimigo disponível</option>
            ) : (
              targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name} · {target.hpCurrent}/{target.hpMax} HP
                </option>
              ))
            )}
          </select>
        </label>

        <label>
          Arma
          <select
            value={selectedWeapon?.id ?? ""}
            disabled={busy || weapons.length === 0}
            onChange={(event) => setWeaponId(event.target.value)}
          >
            {weapons.length === 0 ? (
              <option value="">Nenhuma arma vinculada</option>
            ) : (
              weapons.map((weapon) => <option key={weapon.id} value={weapon.id}>{weapon.name}</option>)
            )}
          </select>
          {selectedWeapon && (
            <small className="player-mesa-weapon-ammo">
              {hasMagazine
                ? ammo === undefined
                  ? "Munição indisponível"
                  : `Munição ${ammo}/${selectedWeapon.magazine}`
                : "Sem magazine"}
              {typeof selectedWeapon.rateOfFire === "number" ? ` · ROF ${selectedWeapon.rateOfFire}` : ""}
            </small>
          )}
        </label>

        <label>
          Modo
          <select value={attackMode} disabled={busy} onChange={(event) => setAttackMode(event.target.value as AttackMode)}>
            <option value="aimed">Aimed</option>
            <option value="normal">Normal</option>
          </select>
        </label>

        {attackMode === "aimed" && (
          <label>
            Local
            <select
              value={aimedTarget}
              disabled={busy}
              onChange={(event) => setAimedTarget(event.target.value as AimedLocation)}
            >
              <option value="head">Head</option>
              <option value="leg">Leg</option>
              <option value="held_item">Held Item</option>
            </select>
          </label>
        )}

        <button
          type="button"
          className="mesa-primary player-mesa-attack-button"
          onClick={() => void submitAttack()}
          disabled={
            busy ||
            !myTurn ||
            Boolean(me?.isDead) ||
            (me?.actionsRemaining ?? 0) <= 0 ||
            !selectedTargetId ||
            !selectedWeapon ||
            outOfAmmo ||
            ammoUnavailable
          }
          title={
            !myTurn
              ? "Só é possível atacar no seu turno."
              : outOfAmmo
                ? "Sem munição no carregador."
                : "O servidor resolve rolagem, armadura e dano."
          }
        >
          {busy ? "Resolvendo..." : outOfAmmo ? "[ SEM MUNIÇÃO ]" : "[ ATACAR ]"}
        </button>
      </div>

      {attackError && <p className="player-mesa-error">{attackError}</p>}
      {feedback && <AttackFeedbackView feedback={feedback} />}

      {/* --- Ações de turno ------------------------------------------------ */}
      <div className="player-mesa-turn-actions">
        <div className="player-mesa-move">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={Math.max(1, me?.movementRemaining ?? 1)}
            value={moveDraft}
            onChange={(event) => setMoveDraft(event.target.value)}
            placeholder={me ? `até ${me.movementRemaining}m` : "metros"}
            aria-label="Metros do movimento"
             disabled={busy || moving || !myTurn}
          />
          <button
            type="button"
            className="mesa-action"
             disabled={busy || moving || !moveGate?.ok}
            title={moveDraft.trim() === "" ? "Digite quantos metros mover — não custa Action." : moveGate?.message}
             onClick={() => {
               if (!me || !moveGate?.ok || busy || movePending.current) return;
               movePending.current = true;
               setMoving(true);
               setMoveError(null);
               void run(
                 async () => {
                   await moveMesa({ sessionId: state.session.id, actorCombatantId: me.id, distance: moveMeters });
                   setMoveDraft("");
                 },
                 { onError: (message) => setMoveError(message) },
               ).finally(() => {
                 movePending.current = false;
                 setMoving(false);
               });
             }}
           >
             {moving ? "[ MOVENDO... ]" : "[ MOVER ]"}
           </button>
         </div>
         {moveError && <p className="player-mesa-error" role="alert">{moveError}</p>}

        <p className="mesa-hint">Use itens pela ficha para passar pelo gateway correspondente.</p>

        <p className="mesa-hint">O Mestre controla o avanço dos turnos.</p>
      </div>
    </section>
  );
}

function AttackFeedbackView({ feedback }: { feedback: AttackFeedback }) {
  const attack = feedback.attackResult;
  const damage = feedback.damageResult;
  return (
    <div className="player-mesa-feedback">
      <strong>{attack.hit ? "HIT" : "MISS"}</strong>
      <span>
        Ataque: {attack.total} · Defesa: {attack.defenseValue}
      </span>
      {damage && (
        <span>
          Dano: {damage.rawDamage} · Armor: {damage.armorValue} · Final: {damage.damageAfterArmor} · HP:{" "}
          {damage.hpBefore} → {damage.hpAfter}
        </span>
      )}
      {feedback.damageError && <span>{feedback.damageError.message}</span>}
    </div>
  );
}
