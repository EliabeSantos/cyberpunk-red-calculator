"use client";

import { useMemo, useState } from "react";
import { quickhackDefinitions, quickhackOrder } from "@/data/quickhacks";
import { controlMesaDevice, equipMesaQuickhacks, executeMesaNetAction, executeMesaQuickhack, jackInMesa, safeJackOutMesa } from "@/lib/mesa/client";
import { canConnectToAccessPoint, getCyberdeckSlots, getRamMax } from "@/lib/mesa/netrunner";
import { describeHackableObjectControl, hackableObjectTypeLabel, type HackableControlNodeStatus, type HackableDeviceAction } from "@/lib/mesa/hackableObjects";
import type { Character } from "@/types/character";
import type { MesaCombatant, MesaState, TacticalMap } from "@/lib/mesa/types";
import type { TacticalHackableObject } from "@/lib/mesa/types";
import { tacticalDistance } from "@/lib/mesa/tacticalMap";
import type { RunAction } from "./types";

/** Mapa ausente só para cálculo de distância/contexto; nunca é autoridade. */
const EMPTY_TACTICAL_MAP: TacticalMap = { imageUrl: "", enabled: false, width: 1000, height: 600, pixelsPerMeter: 50 };

const CONTROL_NODE_STATUS_LABELS: Record<HackableControlNodeStatus, string> = {
  not_linked: "NÃO VINCULADO",
  not_discovered: "NÃO DESCOBERTO",
  discovered: "DESCOBERTO",
  not_controlled: "DESCOBERTO · NÃO CONTROLADO",
  controlled_by_viewer: "CONTROLADO POR VOCÊ",
  controlled_by_other: "CONTROLADO",
  controlled_by_demon: "CONTROLADO POR DEMON",
};

/** Rótulos, espera e feedback das ações de dispositivo (F1.62/F1.63). */
const DEVICE_ACTION_LABELS: Record<HackableDeviceAction, string> = {
  open: "[ABRIR]",
  close: "[FECHAR]",
  enable: "[ATIVAR CÂMERA]",
  disable: "[DESATIVAR CÂMERA]",
};

const DEVICE_ACTION_PENDING: Record<HackableDeviceAction, string> = {
  open: "ABRINDO...",
  close: "FECHANDO...",
  enable: "ATIVANDO...",
  disable: "DESATIVANDO...",
};

const DEVICE_ACTION_MESSAGES: Record<HackableDeviceAction, string> = {
  open: "Porta aberta.",
  close: "Porta fechada.",
  enable: "CAMERA ONLINE",
  disable: "CAMERA DESATIVADA",
};

interface Props {
  state: MesaState;
  me: MesaCombatant | null;
  character: Character | null;
  target: MesaCombatant | null;
  busy: boolean;
  run: RunAction;
  selectedHackableObject?: TacticalHackableObject | null;
  selectedAccessPointId?: string | null;
  onSelectAccessPoint?: (accessPointId: string | null) => void;
}

export default function PlayerNetrunnerPanel({ state, me, character, target, busy, run, selectedHackableObject, selectedAccessPointId, onSelectAccessPoint }: Props) {
  const [connectionType, setConnectionType] = useState<"wireless" | "cable">("wireless");
  const [selectedQuickhacks, setSelectedQuickhacks] = useState<string[]>(me?.netrunnerState?.equippedQuickhackIds ?? []);
  const [selectedNetTargetId, setSelectedNetTargetId] = useState<string | null>(null);
  const netrunner = me?.netrunnerState;
  const interfaceRank = netrunner?.interfaceRank || character?.roleAbilities.find((ability) => ability.abilityId === "interface")?.rank || 0;
  const hasCyberdeck = Boolean(character?.inventory.some((item) => item.quantity > 0 && ((item.catalogItemId ?? item.id).toLowerCase() === "cyberdeck" || item.name.toLowerCase() === "cyberdeck")));
  const isNetrunner = character?.primaryRole === "netrunner" || interfaceRank > 0;
  const accessPoints = state.session.tacticalMap?.accessPoints ?? [];
  const tacticalMap = state.session.tacticalMap ?? EMPTY_TACTICAL_MAP;
  const selectedAccessPoint = accessPoints.find((point) => point.id === selectedAccessPointId) ?? null;
  const targetLabel = target?.name ?? "selecione um inimigo no mapa";
  const ramMax = netrunner?.ramMax || getRamMax(interfaceRank);
  const slots = netrunner?.cyberdeckSlots || getCyberdeckSlots(interfaceRank);
  const equipped = netrunner?.equippedQuickhackIds ?? selectedQuickhacks;
  const available = useMemo(() => quickhackOrder.map((id) => quickhackDefinitions[id]).filter(Boolean), []);
  const selectedObjectDistance = selectedHackableObject && me ? tacticalDistance(me.position ?? { x: 0, y: 0 }, selectedHackableObject.position, tacticalMap) : null;
  const selectedObjectNode = selectedHackableObject?.controlNodeId ? state.netArchitecture?.nodes.find((node) => node.id === selectedHackableObject.controlNodeId) ?? null : null;
  const objectControl = selectedHackableObject
    ? describeHackableObjectControl({
        object: selectedHackableObject,
        map: tacticalMap,
        netrunner: netrunner ?? null,
        viewerCombatantId: me?.id ?? null,
        controlNode: selectedObjectNode,
      })
    : null;
  const connectedAccessPoint = netrunner?.connectedAccessPointId ? accessPoints.find((point) => point.id === netrunner.connectedAccessPointId) ?? null : null;
  const accessPointDistance = connectedAccessPoint && me ? tacticalDistance(me.position ?? { x: 0, y: 0 }, connectedAccessPoint.position, tacticalMap) : null;
  const selectedAccessPointDistance = selectedAccessPoint && me ? tacticalDistance(me.position ?? { x: 0, y: 0 }, selectedAccessPoint.position, tacticalMap) : null;
  const selectedConnectionType = connectionType;
  const selectedAccessPointConnection = selectedAccessPoint && me
    ? canConnectToAccessPoint({ accessPoint: selectedAccessPoint, connectionType: selectedConnectionType, netrunnerPosition: me.position ?? { x: 0, y: 0 }, map: tacticalMap })
    : null;
  const isMyTurn = state.combat?.activeCombatantId === me?.id;
  const activeIce = useMemo(
    () => state.netArchitecture?.nodes.filter((node) => node.type === "black_ice" && node.blackIceState === "active" && "blackIce" in node) ?? [],
    [state.netArchitecture?.nodes],
  );
  const discoveredDemon = state.netArchitecture?.nodes.find((node) => node.type === "demon" && node.demon) ?? null;
  const activeIceCombatants = state.combatants.filter((combatant) => combatant.kind === "net_ice" && !combatant.isDead);
  const activeIceTurn = state.combat?.activeCombatantId ? activeIceCombatants.find((combatant) => combatant.id === state.combat?.activeCombatantId) ?? null : null;
  const [connectionPending, setConnectionPending] = useState(false);
  const [devicePendingAction, setDevicePendingAction] = useState<HackableDeviceAction | null>(null);

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
      {netrunner?.isJackedIn && activeIceTurn && <div className="net-ice-turn-banner" role="status"><strong>BLACK ICE — TURNO</strong><span>{activeIceTurn.name}</span></div>}
      {netrunner?.isJackedIn && <section className="net-targeting-panel" aria-label="NET targets"><header><strong>NET TARGETS</strong><span>seleção separada do combate físico</span></header>{activeIce.length === 0 ? <p className="mesa-hint">Nenhum Black ICE ativo descoberto.</p> : <div className="net-target-list">{activeIce.map((node) => { const ice = "blackIce" in node ? node.blackIce : undefined; const selected = selectedNetTargetId === node.id; return <button key={node.id} type="button" className={selected ? "is-selected" : ""} onClick={() => setSelectedNetTargetId(node.id)} aria-pressed={selected}><span>◆</span><strong>{node.name ?? "Black ICE"}</strong><small>{ice?.type ?? "—"} · REZZ {ice?.rezz ?? "—"}/{ice?.maxRezz ?? "—"}</small></button>; })}</div>}</section>}
       {selectedAccessPoint && <section className="netrunner-access-point-context" aria-label="Access Point selecionado"><span className="mesa-eyebrow">ACCESS POINT</span><h4>{selectedAccessPoint.id}</h4><p>TIPO · {selectedAccessPoint.connectionTypes.map((type) => type === "wireless" ? "Wireless" : "Cabo").join(" / ")}</p><p>DISTÂNCIA · {selectedAccessPointDistance ?? "—"}m · LIMITE · 6m</p><p>STATUS · {!selectedAccessPoint.active ? "INDISPONÍVEL" : !selectedAccessPointConnection ? "INDISPONÍVEL" : selectedAccessPointConnection.ok ? "DISPONÍVEL PARA JACK IN" : selectedAccessPointConnection.reason === "out_of_range" ? "FORA DE ALCANCE" : "INDISPONÍVEL"}</p>{!netrunner?.isJackedIn && <><label>Conexão<select value={connectionType} onChange={(event) => setConnectionType(event.target.value as "wireless" | "cable")} disabled={busy || connectionPending}><option value="wireless" disabled={!selectedAccessPoint.connectionTypes.includes("wireless")}>Wireless</option><option value="cable" disabled={!selectedAccessPoint.connectionTypes.includes("cable")}>Cabo</option></select></label><button type="button" disabled={busy || connectionPending || !selectedAccessPointConnection?.ok || !hasCyberdeck || netrunner?.cyberdeckStatus === "destroyed"} onClick={() => { setConnectionPending(true); void run(() => jackInMesa({ sessionId: state.session.id, combatantId: me.id, accessPointId: selectedAccessPoint.id, connectionType }), { success: "Jack In realizado." }).finally(() => setConnectionPending(false)); }}>{connectionPending ? "CONECTANDO..." : "JACK IN"}</button></>}</section>}
       {selectedHackableObject && objectControl && (() => {
        const controlNodeLabel = CONTROL_NODE_STATUS_LABELS[objectControl.controlNodeStatus];
        const statusLabel = objectControl.doorState
          ? objectControl.doorState === "open" ? "PORTA ABERTA" : "PORTA FECHADA"
          : objectControl.cameraState
            ? objectControl.cameraState === "online" ? "CAMERA ONLINE" : "CAMERA DESATIVADA"
            : selectedHackableObject.active ? "DISPONÍVEL" : "DESATIVADO";
        const canTakeControl = Boolean(selectedObjectNode && selectedObjectNode.type === "control_node" && selectedObjectNode.controlState !== "controlled");
        return (
          <section className="netrunner-object-context" aria-label="HACKABLE OBJECT">
            <span className="mesa-eyebrow">HACKABLE OBJECT</span>
            <h4>{selectedHackableObject.name ?? hackableObjectTypeLabel(selectedHackableObject.type)}</h4>
            <p>TIPO · {hackableObjectTypeLabel(selectedHackableObject.type)}</p>
            <p>{selectedObjectDistance !== null ? `DISTÂNCIA · ${selectedObjectDistance}m` : "DISTÂNCIA · INDISPONÍVEL"}</p>
            <p>CONTROL NODE · {controlNodeLabel}</p>
            <p>STATUS · {statusLabel} · EFEITO {objectControl.effectStatus}</p>
            {objectControl.ready ? (
              <div className="net-object-actions" role="group" aria-label="Ações do dispositivo">
                {objectControl.actions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    disabled={busy || devicePendingAction !== null}
                    onClick={() => {
                      setDevicePendingAction(action);
                      void run(async () => {
                        await controlMesaDevice({ sessionId: state.session.id, objectId: selectedHackableObject.id, action });
                      }, { success: DEVICE_ACTION_MESSAGES[action] }).finally(() => setDevicePendingAction(null));
                    }}
                  >
                    {devicePendingAction === action ? DEVICE_ACTION_PENDING[action] : DEVICE_ACTION_LABELS[action]}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mesa-hint" role="status">
                {objectControl.message}{objectControl.detail ? ` · ${objectControl.detail}` : ""}
              </p>
            )}
            <button
              type="button"
              disabled={!canTakeControl || busy || (netrunner?.netActionsRemaining ?? 0) < 1}
              title={canTakeControl ? "A ação usa o Control Node; o objeto não inventa efeitos próprios." : "Control Node já controlado ou indisponível."}
              onClick={() => selectedObjectNode && void run(async () => { await executeMesaNetAction({ sessionId: state.session.id, action: "control", targetId: selectedObjectNode.id }); }, { success: "Control Node acessado." })}
            >
              CONTROL · {selectedObjectNode?.name ?? selectedObjectNode?.id ?? "NODE"} · 1 NET Action
            </button>
          </section>
        );
      })()}
       {target && <section className="net-target-context" aria-label="NET target selecionado"><span className="mesa-eyebrow">NET TARGET</span><h4>{target.name}</h4><p>ESTADO · {target.isDead ? "FORA DE COMBATE" : "ATIVO"}</p><p>RAM DISPONÍVEL · {netrunner?.ramCurrent ?? ramMax} · NET ACTIONS · {netrunner?.netActionsRemaining ?? 0}</p><p>ALVO DE COMBATE FÍSICO · seleção NET separada das ações do alvo</p></section>}
       {!netrunner?.isJackedIn ? (
        <>
           {!selectedAccessPoint && <label>Access Point<select value={selectedAccessPointId ?? ""} onChange={(event) => onSelectAccessPoint?.(event.target.value || null)} disabled={busy}><option value="">Selecione no Tactical Map</option>{accessPoints.map((point) => <option key={point.id} value={point.id} disabled={!point.active}>{point.id}</option>)}</select></label>}
           {!selectedAccessPoint && <label>Conexão<select value={connectionType} onChange={(event) => setConnectionType(event.target.value as "wireless" | "cable")} disabled={busy}><option value="wireless">Wireless</option><option value="cable">Cabo</option></select></label>}
            {!selectedAccessPoint && <p className="mesa-hint">Selecione um Access Point no Tactical Map para ver o painel de conexão.</p>}
        </>
      ) : (
         <div className={`netrunner-jackout ${activeIce.length ? "has-ice" : ""}`}>{activeIce.length > 0 && <><strong>⚠ BLACK ICE ENGAGED</strong><span>Jack Out inseguro: o Black ICE poderá atacar antes da desconexão.</span></>}<button type="button" disabled={busy} onClick={() => void run(() => safeJackOutMesa(state.session.id, me.id), { success: "Jack Out realizado." })}>{activeIce.length ? "JACK OUT" : "SAFE JACK OUT"}</button></div>
      )}
      <div className="quickhack-loadout">
        <strong>Quickhacks equipados ({equipped.length}/4)</strong>
        {available.map((quickhack) => <label key={quickhack.id}><input type="checkbox" checked={selectedQuickhacks.includes(quickhack.id)} onChange={() => toggleQuickhack(quickhack.id)} disabled={busy} /> {quickhack.name} ({quickhack.ramCost} RAM)</label>)}
        <button type="button" disabled={busy || selectedQuickhacks.length > 4} onClick={() => void run(() => equipMesaQuickhacks(state.session.id, me.id, selectedQuickhacks), { success: "Loadout atualizado." })}>Equipar loadout</button>
      </div>
        <section className="quickhack-actions" aria-label="Quickhacks de combate"><header><strong>QUICKHACKS</strong><span>ALVO: {target ? targetLabel : "SELECIONE UM INIMIGO"}</span></header>{available.length === 0 ? <p className="mesa-hint">Nenhum Quickhack disponível.</p> : available.map((quickhack) => { const reason = quickhackReason(quickhack); return <article className={`quickhack-card ${reason ? "is-unavailable" : "is-ready"}`} key={quickhack.id}><div><strong>{quickhack.name}</strong><span>RAM {quickhack.ramCost} · DV {quickhack.dv}</span></div><p>{quickhack.effect}</p><small>{quickhack.duration}</small><button type="button" disabled={busy || Boolean(reason)} title={reason ?? undefined} onClick={() => target && void run(async () => { await executeMesaQuickhack({ sessionId: state.session.id, quickhackId: quickhack.id, targetCombatantId: target.id }); }, { success: `${quickhack.name} executado.` })}>{reason ?? "EXECUTAR"}</button></article>; })}</section>
      {netrunner?.isJackedIn && state.netArchitecture && <section className="net-architecture-view" aria-label="NET Architecture"><header><strong>{state.netArchitecture.name}</strong><span>FLOOR {state.netArchitecture.currentFloor}</span></header>{state.netArchitecture.nodes.length === 0 ? <p className="mesa-hint">Nenhum Node descoberto neste Floor.</p> : <div className="net-node-list">{state.netArchitecture.nodes.map((node) => <div className={`net-node-card node-${node.type}`} key={node.id}><span className="net-node-symbol">{node.type === "black_ice" ? "◆" : node.type === "demon" ? "◉" : "●"}</span><div><strong>{node.name ?? node.type}</strong><span>{node.type.replaceAll("_", " ")}</span></div>{node.type === "black_ice" && "blackIce" in node && node.blackIce ? <b>{node.blackIceState ?? "—"} · {node.blackIce.rezz}/{node.blackIce.maxRezz}</b> : null}{node.type === "demon" && node.demon ? <b>{node.demon.state} · {(node.demon.controlledNodeIds ?? []).length} nodes</b> : null}</div>)}</div>}{discoveredDemon && "demon" in discoveredDemon && discoveredDemon.demon && <div className="net-demon-card"><strong>DEMON · {discoveredDemon.demon.state}</strong><span>CONTROL NODES · {(discoveredDemon.demon.controlledNodeIds ?? []).length}</span></div>}</section>}
      {netrunner?.isJackedIn && state.netArchitecture && <div className="net-actions" aria-label="NET Actions"><strong>NET Actions</strong><button type="button" disabled={busy || netrunner.netActionsRemaining < 1} onClick={() => void run(async () => { await executeMesaNetAction({ sessionId: state.session.id, action: "pathfinder" });  }, { success: "Pathfinder executado." })}>PATHFINDER · 1 NET Action</button>{state.netArchitecture.nodes.filter((node) => node.type === "password" && node.state === "locked").map((node) => <button key={`backdoor:${node.id}`} type="button" disabled={busy || netrunner.netActionsRemaining < 1} onClick={() => void run(async () => { await executeMesaNetAction({ sessionId: state.session.id, action: "backdoor", targetId: node.id });  }, { success: "Backdoor executado." })}>BACKDOOR · {node.name ?? node.id} · DV {"dv" in node ? node.dv ?? "—" : "—"}</button>)}{state.netArchitecture.nodes.filter((node) => node.type === "control_node" && node.controlState !== "controlled").map((node) => <button key={`control:${node.id}`} type="button" disabled={busy || netrunner.netActionsRemaining < 1} onClick={() => void run(async () => { await executeMesaNetAction({ sessionId: state.session.id, action: "control", targetId: node.id });  }, { success: "Control executado." })}>CONTROL · {node.name ?? node.id} · DV {"dv" in node ? node.dv ?? "—" : "—"}</button>)}{state.netArchitecture.nodes.filter((node) => node.type === "black_ice" && node.blackIceState === "active" && "blackIce" in node).map((node) => { const ice = "blackIce" in node ? node.blackIce : undefined; return <div key={`ice:${node.id}`}><span>{node.name ?? "Black ICE"} · {ice?.type ?? "—"} · {ice?.rezz ?? "—"}/{ice?.maxRezz ?? "—"}</span><button type="button" disabled={busy || netrunner.netActionsRemaining < 1} onClick={() => void run(async () => { await executeMesaNetAction({ sessionId: state.session.id, action: "zap", targetId: node.id });  }, { success: "Zap executado." })}>ZAP · 1 NET Action</button>{netrunner.engagedBlackIceIds?.includes(node.id) ? <button type="button" disabled={busy || netrunner.netActionsRemaining < 1} onClick={() => void run(async () => { await executeMesaNetAction({ sessionId: state.session.id, action: "slide", targetId: node.id });  }, { success: "Slide executado." })}>SLIDE · 1 NET Action</button> : null}</div>; })}</div>}
    </section>
  );
}
