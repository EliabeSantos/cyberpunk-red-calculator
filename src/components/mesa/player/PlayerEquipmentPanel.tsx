"use client";

/**
 * F1.12.3 — equipamento do Player: armas, munição server-side e recarga.
 *
 * A munição NUNCA vem do navegador: `me.ammoByWeapon` é a coluna
 * `mesa_combatants.combat_ammo`, mantida pelo servidor a cada tiro/recarga.
 * Este bloco só envia a intenção (`reloadMesa`) e redesenha o estado devolvido.
 */

import { useRef, useState } from "react";

import { reloadMesa } from "@/lib/mesa/client";
import { evaluateMesaAction } from "@/lib/mesa/actionGate";
import type { Character } from "@/types/character";
import type { PlayerPanelBase } from "./types";

interface Props extends PlayerPanelBase {
  weapons: Character["weapons"];
}

export default function PlayerEquipmentPanel({ state, me, busy, run, weapons }: Props) {
  const [reloadingWeaponId, setReloadingWeaponId] = useState<string | null>(null);
  const [reloadFeedback, setReloadFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const reloadInFlight = useRef(new Set<string>());

  const combatActive = state.combat?.status === "active" && state.combat.initiativeStarted;
  const activeId = state.combat?.activeCombatantId ?? null;
  const myTurn = Boolean(activeId && me && activeId === me.id);

  function canAttemptReload(weapon: Character["weapons"][number]): boolean {
    if (!me || !combatActive || !myTurn || me.isDead) return false;
    if (typeof weapon.id !== "string" || typeof weapon.magazine !== "number" || weapon.magazine <= 0) return false;
    const ammo = me.ammoByWeapon?.[weapon.id];
    if (typeof ammo !== "number" || ammo >= weapon.magazine) return false;
    // Mesma checagem do servidor: recarga custa 1 Action.
    return evaluateMesaAction({ state, combatant: me, actionType: "reload" }).ok;
  }

  async function submitReload(weaponId: string) {
    if (!me || busy || reloadInFlight.current.has(weaponId) || reloadingWeaponId) return;
    const weapon = weapons.find((candidate) => candidate.id === weaponId);
    if (!weapon || !canAttemptReload(weapon)) return;

    reloadInFlight.current.add(weaponId);
    setReloadingWeaponId(weaponId);
    setReloadFeedback(null);
    try {
      await run(
        async () => {
          await reloadMesa({ sessionId: state.session.id, weaponId, resolutionId: crypto.randomUUID() });
          setReloadFeedback({ kind: "success", message: "Recarga concluída. Estado da Mesa atualizado." });
        },
        {
          onError: (message) => setReloadFeedback({ kind: "error", message }),
        },
      );
    } finally {
      reloadInFlight.current.delete(weaponId);
      setReloadingWeaponId(null);
    }
  }

  if (!me) return null;

  return (
    <section className="player-mesa-panel player-mesa-weapons">
      <div className="player-mesa-section-heading">
        <span className="mesa-eyebrow">EQUIPAMENTO</span>
        <strong>Armas e munição</strong>
      </div>

      {!myTurn && <p className="mesa-hint">Aguarde o seu turno para recarregar.</p>}
      {myTurn && me.actionsRemaining <= 0 && (
        <p className="mesa-hint">Sem Actions restantes neste turno.</p>
      )}

      <div className="player-mesa-weapon-list">
        {weapons.length === 0 && <p className="mesa-hint">Nenhuma arma vinculada disponível.</p>}
        {weapons.map((weapon) => {
          const ammo = weapon.id ? me.ammoByWeapon?.[weapon.id] : undefined;
          const hasMagazine = typeof weapon.magazine === "number" && weapon.magazine > 0;
          const unavailable = hasMagazine && typeof ammo !== "number";
          const full = hasMagazine && typeof ammo === "number" && ammo >= (weapon.magazine ?? 0);
          const disabled = busy || reloadingWeaponId !== null || !canAttemptReload(weapon) || unavailable || full;

          return (
            <article className="player-mesa-weapon-card" key={weapon.id}>
              <div className="player-mesa-weapon-heading">
                <strong>{weapon.name}</strong>
                {typeof weapon.rateOfFire === "number" && <span>ROF {weapon.rateOfFire}</span>}
              </div>
              <div className="player-mesa-weapon-details">
                <span>
                  {hasMagazine ? (typeof ammo === "number" ? `${ammo}/${weapon.magazine ?? 0}` : "—/—") : "Sem magazine"}
                </span>
                <small>{hasMagazine ? "munição server-side" : "arma sem recarga"}</small>
              </div>
              {hasMagazine && (
                <button
                  type="button"
                  className="mesa-secondary player-mesa-reload"
                  onClick={() => void submitReload(weapon.id)}
                  disabled={disabled}
                  title={
                    unavailable
                      ? "Munição server-side indisponível"
                      : full
                        ? "Carregador cheio"
                        : !myTurn
                          ? "Recarga só no seu turno."
                          : undefined
                  }
                >
                  {reloadingWeaponId === weapon.id
                    ? "Recarregando..."
                    : full
                      ? "Carregador cheio"
                      : unavailable
                        ? "Munição indisponível"
                        : "Recarregar"}
                </button>
              )}
            </article>
          );
        })}
      </div>

      {reloadFeedback && (
        <p className={`player-mesa-reload-feedback ${reloadFeedback.kind}`}>{reloadFeedback.message}</p>
      )}
    </section>
  );
}
