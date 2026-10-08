"use client";

import type { MesaState } from "@/lib/mesa/types";

export default function GmNetArchitecturePanel({ state }: { state: MesaState }) {
  if (state.viewer.role !== "gm" || !state.netArchitectures?.length) return null;
  return <section className="player-mesa-panel" aria-label="NET Architecture administrativa">
    <h3>NET Architecture (GM)</h3>
    {state.netArchitectures.map((architecture) => <details key={architecture.id} open>
      <summary>{architecture.name}</summary>
       {architecture.floors.map((floor) => <div key={floor.id}><strong>Floor {floor.index}</strong>{floor.nodes.map((node) => <div key={node.id}>{node.name ?? node.type} · {node.type}{node.type === "password" ? ` · ${node.state}${node.dv ? ` · DV ${node.dv}` : ""}` : ""}{node.type === "control_node" && node.controlledByDemonId ? ` · Demon ${node.controlledByDemonId}` : ""}{node.type === "demon" && node.demon ? ` · ${node.demon.state} · Controls ${(node.demon.controlledNodeIds ?? []).length}` : ""}{node.type === "file" && node.content ? <p>{node.content}</p> : null}</div>)}</div>)}
    </details>)}
  </section>;
}
