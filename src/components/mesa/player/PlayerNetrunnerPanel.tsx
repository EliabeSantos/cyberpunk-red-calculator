"use client";

import { useEffect, useMemo, useState } from "react";
import { quickhackDefinitions, quickhackOrder } from "@/data/quickhacks";
import { equipMesaQuickhacks, executeMesaNetAction, executeMesaQuickhack, jackInMesa, safeJackOutMesa } from "@/lib/mesa/client";
import { getCyberdeckSlots, getRamMax } from "@/lib/mesa/netrunner";
import type { Character } from "@/types/character";
import type { MesaCombatant, MesaState } from "@/lib/mesa/types";
import type { TacticalHackableObject } from "@/lib/mesa/types";
import { tacticalDistance } from "@/lib/mesa/tacticalMap";
import type { RunAction } from "./types";

interface Props {
  state: MesaState;
  me: MesaCombatant | null;
  character: Character | null;
  target: MesaCombatant | null;
  busy: boolean;
  run: RunAction;
  onChanged: () => Promise<void>;
  selectedHackableObject?: TacticalHackableObject | null;
}

export default function PlayerNetrunnerPanel({ state, me, character, target, busy, run, onChanged, selectedHackableObject }: Props) {
  const [selectedAccessPoint, setSelectedAccessPoint] = useState(state.session.tacticalMap?.accessPoints?.[0]?.id ?? "");
  const [connectionType, setConnectionType] = useState<"wireless" | "cable">("wireless");
  const [selectedQuickhacks, setSelectedQuickhacks] = useState<string[]>(me?.netrunnerState?.equippedQuickhackIds ?? []);
  const netrunner = me?.netrunnerState;
  const interfaceRank = netrunner?.interfaceRank || character?.roleAbilities.find((ability) => ability.abilityId === "interface")?.rank || 0;
  const hasCyberdeck = Boolean(character?.inventory.some((item) => item.quantity > 0 && ((item.catalogItemId ?? item.id).toLowerCase() === "cyberdeck" || item.name.toLowerCase() === "cyberdeck")));
  const isNetrunner = character?.primaryRole === "netrunner" || interfaceRank > 0;
  const accessPoints = state.session.tacticalMap?.accessPoints ?? [];
  const targetLabel = target?.name ?? "selecione um inimigo no mapa";
  const ramMax = netrunner?.ramMax || getRamMax(interfaceRank);
  const slots = netrunner?.cyberdeckSlots || getCyberdeckSlots(interfaceRank);
  const equipped = netrunner?.equippedQuickhackIds ?? selectedQuickhacks;
  const available = useMemo(() => quickhackOrder.map((id) => quickhackDefinitions[id]).filter(Boolean), []);
  const selectedObjectDistance = selectedHackableObject && me ? tacticalDistance(me.position ?? { x: 0, y: 0 }, selectedHackableObject.position, state.session.tacticalMap ?? { imageUrl: "", enabled: false, width: 1000, height: 600, pixelsPerMeter: 50 }) : null;
  const selectedObjectNode = selectedHackableObject?.linkedControlNodeId ? state.netArchitecture?.nodes.find((node) => node.id === selectedHackableObject.linkedControlNodeId) : null;
  const connectedAccessPoint = netrunner?.connectedAccessPointId ? accessPoints.find((point) => point.id === netrunner.connectedAccessPointId) ?? null : null;
  const accessPointDistance = connectedAccessPoint && me ? tacticalDistance(me.position ?? { x: 0, y: 0 }, connectedAccessPoint.position, state.session.tacticalMap ?? { imageUrl: "", enabled: false, width: 1000, height: 600, pixelsPerMeter: 50 }) : null;
  const isMyTurn = state.combat?.activeCombatantId === me?.id;
  const activeIce = state.netArchitecture?.nodes.filter((node) => node.type === "black_ice" && node.blackIceState === "active" && "blackIce" in node) ?? [];
  const discoveredDemon = state.netArchitecture?.nodes.find((node) => node.type === "demon" && node.demon) ?? null;
  const [connectionPending, setConnectionPending] = useState(false);

  useEffect(() => {
    if (me?.netrunnerState) setSelectedQuickhacks(me.netrunnerState.equippedQuickhackIds);
  }, [me?.id, me?.netrunnerState?.equippedQuickhackIds]);

  if (!isNetrunner || !hasCyberdeck || !me || state.viewer.role !== "player") return null;

  function toggleQuickhack(id: string) {
    setSelectedQuickhacks((current) => current.includes(id) ? current.filter((entry) => entry !== id) : current.length >= 4 ? current : [...current, id]);
  }

  function quickhackReason(quickhack: typeof available[number]): string | null {
    if (!netrunner?.isJackedIn) return "Jack In necessário";
    if (!equipped.includes(quickhack.id)) return "Não equipado";
    if (!target) return "Selecione um inimigo válido";
    if (netrunner.ramCurrent < quickhack.ramCost) return "RAM insuficiente";
    if (netrunner.netActionsRemaining < 1) return "Sem NET Action";
    return null;
  }

  return (
    <section className="player-mesa-panel" aria-label="Netrunning">
      <h3>Netrunning</h3>
      <p className="mesa-hint">Interface Rank {interfaceRank} · Cyberdeck {slots} slots</p>
      <div className="netrunner-resource-hud"><div><span>RAM</span><strong>{netrunner?.ramCurrent ?? ramMax}/{ramMax}</strong><i aria-hidden="true"><b style={{ width: `${Math.max(0, Math.min(100, ((netrunner?.ramCurrent ?? ramMax) / ramMax) * 100))}%` }} /></i></div><div><span>NET ACTIONS</span><strong>{netrunner?.netActionsRemaining ?? 0}/{netrunner?.netActionsMax ?? interfaceRank}</strong><i className="net-action-pips" aria-label={`${netrunner?.netActionsRemaining ?? 0} NET Actions disponíveis`}>{Array.from({ length: netrunner?.netActionsMax ?? interfaceRank }, (_, index) => <b key={index} className={index < (netrunner?.netActionsRemaining ?? 0) ? "is-full" : ""} />)}</i></div></div>
      <div className={`netrunner-connection-status ${netrunner?.isJackedIn ? "is-online" : "is-offline"}`}><strong>{netrunner?.isJackedIn ? "NET ONLINE" : "NET OFFLINE"}</strong>{netrunner?.isJackedIn && <span>FLOOR {netrunner.currentFloor ?? 1} · {connectedAccessPoint?.id ?? "ACCESS POINT"} · {accessPointDistance ?? "—"}m{netrunner.connectionType === "wireless" ? " / 6m" : ""}</span>}</div>
      {netrunner?.isJackedIn && <div className="netrunner-turn-hud"><span className={isMyTurn ? "is-current" : ""}>{isMyTurn ? "SEU TURNO NET" : state.combat?.activeCombatantId ? `TURNO: ${state.combatants.find((entry) => entry.id === state.combat?.activeCombatantId)?.name ?? "—"}` : "TURNO PENDENTE"}</span><span>{netrunner.meatspaceActionUsedForNetrunning ? "AÇÃO DA CARNE USADA" : "AÇÃO DA CARNE DISPONÍVEL"}</span></div>}
      {selectedHackableObject && <section className="netrunner-object-context" aria-label="Objeto hackeável selecionado"><span className="mesa-eyebrow">INTERFACE FÍSICA</span><h4>{selectedHackableObject.label ?? selectedHackableObject.type}</h4><p>{selectedObjectDistance !== null ? `DISTÂNCIA · ${selectedObjectDistance}m` : "Posição indisponível"}</p><p>STATUS · {selectedHackableObject.active ? "DISPONÍVEL" : "DESATIVADO"}</p><p>CONTROL NODE · {selectedObjectNode ? "DESCOBERTO" : selectedHackableObject.linkedControlNodeId ? "NÃO DESCOBERTO" : "NÃO VINCULADO"}</p><button type="button" disabled={!netrunner?.isJackedIn || busy || !selectedObjectNode} title={!selectedObjectNode ? "Nenhum Control Node autorizado para este objeto." : "A ação usa o Control Node; o objeto não inventa efeitos próprios."} onClick={() => selectedObjectNode && void run(async () => { await executeMesaNetAction({ sessionId: state.session.id, action: "control", targetId: selectedObjectNode.id }); await onChanged(); }, { success: "Control Node acessado." })}>INTERAGIR · CONTROL</button></section>}
       {!netrunner?.isJackedIn ? (
        <>
          <label>Access Point<select value={selectedAccessPoint} onChange={(event) => setSelectedAccessPoint(event.target.value)} disabled={busy}><option value="">Selecione</option>{accessPoints.map((point) => <option key={point.id} value={point.id} disabled={!point.active}>{point.id}</option>)}</select></label>
          <label>Conexão<select value={connectionType} onChange={(event) => setConnectionType(event.target.value as "wireless" | "cable")} disabled={busy}><option value="wireless">Wireless</option><option value="cable">Cabo</option></select></label>
           <button type="button" disabled={busy || connectionPending || !selectedAccessPoint} onClick={() => { setConnectionPending(true); void run(() => jackInMesa({ sessionId: state.session.id, combatantId: me.id, accessPointId: selectedAccessPoint, connectionType }), { success: "Jack In realizado." }).finally(() => setConnectionPending(false)); }}>{connectionPending ? "CONECTANDO..." : "JACK IN"}</button>
        </>
      ) : (
         <div className={`netrunner-jackout ${activeIce.length ? "has-ice" : ""}`}>{activeIce.length > 0 && <><strong>⚠ BLACK ICE ENGAGED</strong><span>Jack Out inseguro: o Black ICE poderá atacar antes da desconexão.</span></>}<button type="button" disabled={busy} onClick={() => void run(() => safeJackOutMesa(state.session.id, me.id), { success: "Jack Out realizado." })}>{activeIce.length ? "JACK OUT" : "SAFE JACK OUT"}</button></div>
      )}
      <div className="quickhack-loadout">
        <strong>Quickhacks equipados ({equipped.length}/4)</strong>
        {available.map((quickhack) => <label key={quickhack.id}><input type="checkbox" checked={selectedQuickhacks.includes(quickhack.id)} onChange={() => toggleQuickhack(quickhack.id)} disabled={busy} /> {quickhack.name} ({quickhack.ramCost} RAM)</label>)}
        <button type="button" disabled={busy || selectedQuickhacks.length > 4} onClick={() => void run(() => equipMesaQuickhacks(state.session.id, me.id, selectedQuickhacks), { success: "Loadout atualizado." })}>Equipar loadout</button>
      </div>
      {netrunner?.isJackedIn && <section className="quickhack-actions" aria-label="Quickhacks de combate"><header><strong>QUICKHACKS</strong><span>ALVO: {targetLabel}</span></header>{available.filter((quickhack) => equipped.includes(quickhack.id)).map((quickhack) => { const reason = quickhackReason(quickhack); return <article className={`quickhack-card ${reason ? "is-unavailable" : "is-ready"}`} key={quickhack.id}><div><strong>{quickhack.name}</strong><span>RAM {quickhack.ramCost} · DV {quickhack.dv}</span></div><p>{quickhack.effect}</p><small>{quickhack.duration}</small><button type="button" disabled={busy || Boolean(reason)} title={reason ?? undefined} onClick={() => target && void run(async () => { await executeMesaQuickhack({ sessionId: state.session.id, quickhackId: quickhack.id, targetCombatantId: target.id }); await onChanged(); }, { success: `${quickhack.name} executado.` })}>{reason ?? "EXECUTAR"}</button></article>; })}</section>}
      {netrunner?.isJackedIn && state.netArchitecture && <section className="net-architecture-view" aria-label="NET Architecture"><header><strong>{state.netArchitecture.name}</strong><span>FLOOR {state.netArchitecture.currentFloor}</span></header>{state.netArchitecture.nodes.length === 0 ? <p className="mesa-hint">Nenhum Node descoberto neste Floor.</p> : <div className="net-node-list">{state.netArchitecture.nodes.map((node) => <div className={`net-node-card node-${node.type}`} key={node.id}><span className="net-node-symbol">{node.type === "black_ice" ? "◆" : node.type === "demon" ? "◉" : "●"}</span><div><strong>{node.name ?? node.type}</strong><span>{node.type.replaceAll("_", " ")}</span></div>{node.type === "black_ice" && "blackIce" in node && node.blackIce ? <b>{node.blackIceState ?? "—"} · {node.blackIce.rezz}/{node.blackIce.maxRezz}</b> : null}{node.type === "demon" && node.demon ? <b>{node.demon.state} · {(node.demon.controlledNodeIds ?? []).length} nodes</b> : null}</div>)}</div>}</section>}
      {netrunner?.isJackedIn && state.netArchitecture && <div className="net-actions" aria-label="NET Actions"><strong>NET Actions</strong><button type="button" disabled={busy || netrunner.netActionsRemaining < 1} onClick={() => void run(async () => { await executeMesaNetAction({ sessionId: state.session.id, action: "pathfinder" }); await onChanged(); }, { success: "Pathfinder executado." })}>PATHFINDER · 1 NET Action</button>{state.netArchitecture.nodes.filter((node) => node.type === "password" && node.state === "locked").map((node) => <button key={`backdoor:${node.id}`} type="button" disabled={busy || netrunner.netActionsRemaining < 1} onClick={() => void run(async () => { await executeMesaNetAction({ sessionId: state.session.id, action: "backdoor", targetId: node.id }); await onChanged(); }, { success: "Backdoor executado." })}>BACKDOOR · {node.name ?? node.id} · DV {"dv" in node ? node.dv ?? "—" : "—"}</button>)}{state.netArchitecture.nodes.filter((node) => node.type === "control_node" && node.controlState !== "controlled").map((node) => <button key={`control:${node.id}`} type="button" disabled={busy || netrunner.netActionsRemaining < 1} onClick={() => void run(async () => { await executeMesaNetAction({ sessionId: state.session.id, action: "control", targetId: node.id }); await onChanged(); }, { success: "Control executado." })}>CONTROL · {node.name ?? node.id} · DV {"dv" in node ? node.dv ?? "—" : "—"}</button>)}{state.netArchitecture.nodes.filter((node) => node.type === "black_ice" && node.blackIceState === "active" && "blackIce" in node).map((node) => { const ice = "blackIce" in node ? node.blackIce : undefined; return <div key={`ice:${node.id}`}><span>{node.name ?? "Black ICE"} · {ice?.type ?? "—"} · {ice?.rezz ?? "—"}/{ice?.maxRezz ?? "—"}</span><button type="button" disabled={busy || netrunner.netActionsRemaining < 1} onClick={() => void run(async () => { await executeMesaNetAction({ sessionId: state.session.id, action: "zap", targetId: node.id }); await onChanged(); }, { success: "Zap executado." })}>ZAP · 1 NET Action</button>{netrunner.engagedBlackIceIds?.includes(node.id) ? <button type="button" disabled={busy || netrunner.netActionsRemaining < 1} onClick={() => void run(async () => { await executeMesaNetAction({ sessionId: state.session.id, action: "slide", targetId: node.id }); await onChanged(); }, { success: "Slide executado." })}>SLIDE · 1 NET Action</button> : null}</div>; })}</div>}
    </section>
  );
}
