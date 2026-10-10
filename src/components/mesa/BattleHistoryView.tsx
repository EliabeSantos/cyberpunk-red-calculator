"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchMesaBattle } from "@/lib/mesa/client";
import type { MesaBattle } from "@/lib/mesa/types";

export default function BattleHistoryView({ sessionId, battleId }: { sessionId: string; battleId: string }) {
  const [battle, setBattle] = useState<MesaBattle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchMesaBattle(sessionId, battleId).then(setBattle).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "Não foi possível abrir o histórico.");
    });
  }, [battleId, sessionId]);

  if (error) return <main className="battle-history-page"><p className="mesa-error">{error}</p><Link className="mesa-ghost" href="/ficha">Voltar para a ficha</Link></main>;
  if (!battle) return <main className="battle-history-page loading-screen">Carregando histórico...</main>;

  const map = battle.tacticalMap;
  const eventLog = battle.eventLog ?? [];
  const mapStyle = map?.imageUrl ? { backgroundImage: `url(${map.imageUrl})` } : undefined;

  return (
    <main className="battle-history-page">
      <header className="battle-history-header">
        <div><Link className="battle-history-back" href="/gm/encounters">← Histórico de partidas</Link><p className="mesa-eyebrow">COMBATE ARQUIVADO · SOMENTE LEITURA</p><h1>{battle.encounterName}</h1><p>{battle.joinCode} · {new Date(battle.startedAt).toLocaleString("pt-BR")} {battle.endedAt ? `→ ${new Date(battle.endedAt).toLocaleString("pt-BR")}` : ""}</p></div>
        <div className="battle-history-status">{battle.status === "completed" ? "CONCLUÍDO" : "EM ANDAMENTO"}<strong>{battle.finalRound ?? "—"}<small> rodada final</small></strong></div>
      </header>

      <div className="battle-history-grid">
        <section className="battle-history-map-panel"><div className="battle-history-section-title"><span>Mapa da sessão</span><small>posições registradas ao final</small></div><div className="battle-history-map" style={mapStyle} aria-label="Mapa do combate arquivado">{!map?.imageUrl && <span>Mapa não registrado nesta partida</span>}{battle.combatants.map((combatant) => { const position = combatant.positionEnd ?? combatant.position; if (!position) return null; return <div key={combatant.id} className={`battle-history-token ${combatant.kind === "enemy" ? "is-enemy" : "is-player"} ${combatant.isDead ? "is-dead" : ""}`} style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }} title={combatant.name}><i>{combatant.name.slice(0, 1).toUpperCase()}</i><span>{combatant.name}</span></div>; })}</div></section>
        <section className="battle-history-roster"><div className="battle-history-section-title"><span>Resultado</span><small>{battle.combatants.length} combatentes</small></div><ul>{battle.combatants.map((combatant) => <li key={combatant.id} className={combatant.isDead ? "is-dead" : ""}><span className="battle-history-roster-name"><i className={combatant.kind} />{combatant.name}</span><span>{combatant.removed ? "Saiu" : combatant.isDead ? "Morto" : "Sobreviveu"}</span><strong>{combatant.hpEnd ?? combatant.hpStart}/{combatant.hpMax}</strong></li>)}</ul></section>
      </div>

      <section className="battle-history-log"><div className="battle-history-section-title"><span>Registro de combate</span><small>{eventLog.length} eventos preservados</small></div>{eventLog.length === 0 ? <p className="battle-history-empty">Nenhum evento foi registrado nesta partida.</p> : <ol>{eventLog.map((event, index) => <li key={`${event.at}-${index}`}><time>{new Date(event.at).toLocaleTimeString("pt-BR")}</time><span className={`battle-history-event-kind ${event.kind}`}>{event.kind.replaceAll("_", " ")}</span><p>{event.text}</p></li>)}</ol>}</section>
    </main>
  );
}
