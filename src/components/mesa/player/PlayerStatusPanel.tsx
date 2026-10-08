"use client";

/**
 * F1.12.3 — painel do PRÓPRIO personagem: HP, Action Economy, Armor,
 * Critical Injuries e condições.
 *
 * Tudo lido de `MesaCombatant` (colunas `mesa_combatants`), que é a autoridade
 * durante a Mesa. O Armor aqui é `combat_armor` do servidor (o mesmo que o
 * Damage Engine usa) — não a referência da ficha local.
 */

import Link from "next/link";

import { hpCondition, hpPercent } from "@/lib/mesa/playerScreen";
import type { MesaCombatant } from "@/lib/mesa/types";

interface Props {
  me: MesaCombatant | null;
  /** Nome da ficha local vinculada, quando existe. */
  characterName: string | null;
  isGM?: boolean;
  isControllingEnemy?: boolean;
}

export default function PlayerStatusPanel({
  me,
  characterName,
  isGM = false,
  isControllingEnemy = false,
}: Props) {
  return (
    <section className="player-mesa-panel player-mesa-self">
      <div className="player-mesa-section-heading">
        <span className="mesa-eyebrow">{isControllingEnemy ? "INIMIGO CONTROLADO" : "SEU PERSONAGEM"}</span>
        <strong>
          {me?.name ?? (isGM ? "Nenhum inimigo selecionado" : "Sem personagem vinculado")}
        </strong>
      </div>

      {!me ? (
        <p className="mesa-hint">
          {isGM
            ? "Selecione um inimigo na ordem de iniciativa para controlar seus turnos e ações."
            : <>Vincule uma ficha (no bloco <b>Vínculo</b> abaixo) para entrar no combate.</>}
        </p>
      ) : (
        <>
          <div className="player-mesa-hp-block">
            <div className="player-mesa-hp-values">
              <b>{me.hpCurrent}</b>
              <span>/ {me.hpMax} HP</span>
              <em className={`hp-${hpCondition(me)}`}>
                {me.isDead ? "DERROTADO" : me.hpCurrent <= 0 ? "INCAPACITADO" : `${hpPercent(me)}%`}
              </em>
            </div>
            <div className="player-mesa-hp-bar player-mesa-hp-bar-lg">
              <i className={`hp-${hpCondition(me)}`} style={{ width: `${hpPercent(me)}%` }} />
            </div>
          </div>

          <div className="player-mesa-stat-grid">
            <div className="player-mesa-stat">
              <span>AÇÕES</span>
              <b>
                {me.actionsRemaining}/{me.actionsMax}
              </b>
            </div>
            <div className="player-mesa-stat">
              <span>MOVIMENTO</span>
              <b>
                {me.movementRemaining}/{me.movementMax} m
              </b>
            </div>
            <div className="player-mesa-stat">
              <span>ARMOR</span>
              <b>
                {me.armor
                  ? `C ${me.armor.body} · H ${me.armor.head}`
                  : "—"}
              </b>
            </div>
            <div className="player-mesa-stat">
              <span>INICIATIVA</span>
              <b>{me.initiative ?? "—"}</b>
            </div>
          </div>

          <div className="player-mesa-detail">
            <h3>
              Lesões críticas
              <span>{me.criticalInjuries.length}</span>
            </h3>
            {me.criticalInjuries.length === 0 ? (
              <p className="mesa-hint">Nenhuma lesão registrada na Mesa.</p>
            ) : (
              <ul className="player-mesa-injuries">
                {me.criticalInjuries.map((injury) => (
                  <li key={`${injury.name}-${injury.roll}`}>
                    <strong>{injury.name}</strong>
                    <small>
                      {injury.location} · 2d6 {injury.roll} · {injury.effect}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="player-mesa-detail">
            <h3>
              Condições
              <span>{me.conditions.length}</span>
            </h3>
            {me.conditions.length === 0 ? (
              <p className="mesa-hint">Nenhuma condição ativa.</p>
            ) : (
              <p className="player-mesa-conditions">
                {me.conditions.map((condition) => (
                  <span key={condition}>{condition}</span>
                ))}
              </p>
            )}
          </div>

          <p className="mesa-hint">
            {isControllingEnemy
              ? "Dados do inimigo controlado vêm do estado autoritativo da Mesa."
              : characterName ? (
                <>
                  Ficha vinculada: <b>{characterName}</b>
                  {" · "}
                  <Link href="/">abrir ficha</Link>
                </>
              ) : (
                "Nenhuma ficha local correspondente — os dados acima vêm só da Mesa."
              )}
          </p>
        </>
      )}
    </section>
  );
}
