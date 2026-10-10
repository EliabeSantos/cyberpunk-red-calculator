"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ClockIcon, RotateCwIcon } from "@/components/icons";
import { fetchMesaBattles, listMemberships, MesaApiError } from "@/lib/mesa/client";
import type { MesaBattle } from "@/lib/mesa/types";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function HistoryPageClient() {
  const [battles, setBattles] = useState<MesaBattle[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    let migrationNotice: string | null = null;
    const lists = await Promise.all(listMemberships().filter((entry) => entry.role === "gm").map((entry) =>
      fetchMesaBattles(entry.sessionId).catch((caught: unknown) => {
        if (caught instanceof MesaApiError && caught.code === "migration_pending") migrationNotice = caught.message;
        return [] as MesaBattle[];
      }),
    ));
    setBattles(lists.flat().sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
    setNotice(migrationNotice);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  return (
    <div className="gm-page gm-history-page">
      <header className="gm-page-header enemy-page-header">
        <div className="gm-page-header-main"><span className="gm-page-eyebrow"><ClockIcon /> ARQUIVO // PARTIDAS</span><h1 className="gm-page-title">Histórico</h1><p className="gm-page-subtitle">Reveja cada combate sem reabrir a Mesa.</p></div>
        <div className="enemy-page-header-meta"><span className="enemy-page-signal"><i aria-hidden="true" /> {battles.length} PARTIDAS</span><button className="gm-button gm-button-small" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}><RotateCwIcon /> {loading ? "Atualizando..." : "Atualizar"}</button></div>
      </header>
      {notice && <p className="mesa-notice error">{notice}</p>}
      {!loading && battles.length === 0 && <section className="gm-history-empty"><ClockIcon /><h2>Nenhuma partida arquivada</h2><p>Quando um combate terminar, ele aparecerá aqui com mapa, posições, resultado e registro de eventos.</p><Link className="gm-button" href="/gm/encounters">Ir para Combate</Link></section>}
      {battles.length > 0 && <section className="gm-history-list">{battles.map((battle) => <article key={battle.id} className="encounter-history-card"><div className="encounter-history-card-header"><span className="encounter-history-name">{battle.encounterName}</span><span className={`encounter-history-status ${battle.status}`}><span className="encounter-status-dot" aria-hidden="true" />{battle.status === "completed" ? "Concluída" : "Em andamento"}</span></div><p className="encounter-history-meta">Mesa {battle.joinCode} · {formatDateTime(battle.startedAt)}{battle.endedAt && <> → {formatDateTime(battle.endedAt)}</>}{battle.finalRound ? <> · {battle.finalRound}ª rodada</> : null}</p><Link className="encounter-history-open" href={`/mesa/${battle.sessionId}/historico/${battle.id}`}>Abrir visão da mesa →</Link>{battle.combatants.length > 0 && <ul className="encounter-history-rows">{battle.combatants.map((row) => <li key={row.id} className={row.isDead ? "is-dead" : undefined}><span className="encounter-history-combatant">{row.name}</span><span className="encounter-history-hp">{row.removed ? `${row.hpStart}/${row.hpMax} · saiu` : row.hpEnd === null ? `${row.hpStart}/${row.hpMax}` : `${row.hpEnd}/${row.hpMax}`}</span>{row.isDead && <span className="encounter-history-dead">Morto</span>}</li>)}</ul>}</article>)}</section>}
    </div>
  );
}
