"use client";

/**
 * F1.13.1/F1.13.2 — mochila autoritativa do Player durante a Mesa.
 *
 * Lê `supplies.inventory` do combatente da Mesa (`mesa_combatants.supplies`)
 * e NÃO copia para estrutura local: a lista inteira é derivada a cada render
 * do snapshot do servidor (Realtime / polling), e o `itemId` exibido é o ID
 * ESTÁVEL (`resolveSupplyItemId`), não o rótulo.
 *
 * O botão [Usar] aparece só para o que o sistema já reconhece como item de
 * cura (`getSupplyHealAmount` — mesma regra do servidor) e dispara
 * `POST /api/mesa/[id]/combat/item-heal`, que consome o item, calcula a cura,
 * aplica o HP e debita a Action numa ÚNICA transação. Aqui só mandamos a
 * intenção; nenhum valor final é calculado ou gravado no navegador.
 *
 * Anti-spam: `busy` global + item em voo + um `title` explicando a recusa do
 * servidor. O bloqueio visual NUNCA é segurança — quem valida é a rota.
 */

import { useRef, useState } from "react";

import { getSupplyHealAmount } from "@/data/enemySupplies";
import { resolveSupplyItemId } from "@/data/supplyItems";
import { applyMesaHealingItem } from "@/lib/mesa/client";
import { evaluateMesaAction } from "@/lib/mesa/actionGate";
import type { MesaSupplies } from "@/lib/mesa/types";
import type { PlayerPanelBase } from "./types";

type Feedback = { kind: "ok" | "error"; message: string } | null;

interface Props extends PlayerPanelBase {
  supplies: MesaSupplies | null;
}

export default function PlayerInventoryPanel({ state, me, busy, run, supplies }: Props) {
  const inventory = supplies?.inventory ?? [];
  const [usingItemId, setUsingItemId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const useInFlight = useRef(new Set<string>());

  /** `null` quando a entrada não é utilizável (sem cura, sem estoque). */
  function usableId(entry: (typeof inventory)[number]): string | null {
    const itemId = resolveSupplyItemId(entry);
    if (!itemId || entry.quantity <= 0) return null;
    return getSupplyHealAmount(entry.item) === null ? null : itemId;
  }

  /** Mesma pergunta que o servidor faz (turno, vivo, 1 Action). */
  function gate() {
    if (!me) return { ok: false, message: "Sem personagem vinculado." };
    return evaluateMesaAction({ state, combatant: me, actionType: "item" });
  }

  function reasonFor(entry: (typeof inventory)[number]): string {
    if (!me) return "Sem personagem vinculado.";
    if (me.hpMax > 0 && me.hpCurrent >= me.hpMax) return "HP já está no máximo.";
    if (getSupplyHealAmount(entry.item) === null) return "Este item não restaura HP.";
    const gateResult = gate();
    return gateResult.ok ? "" : gateResult.message || "Ação indisponível no momento.";
  }

  async function submitUse(itemId: string) {
    if (!me || busy || usingItemId !== null || useInFlight.current.has(itemId)) return;
    useInFlight.current.add(itemId);
    setUsingItemId(itemId);
    setFeedback(null);
    try {
      await run(
        async () => {
          const result = await applyMesaHealingItem({
            sessionId: state.session.id,
            actorCombatantId: me.id,
            itemId,
            resolutionId: crypto.randomUUID(),
          });
          setFeedback({
            kind: "ok",
            message: `${result.itemName}: +${result.restored} HP (${result.hpAfter}/${result.hpMax}) · resta ${result.quantityAfter}`,
          });
        },
        { onError: (message) => setFeedback({ kind: "error", message }) },
      );
    } finally {
      useInFlight.current.delete(itemId);
      setUsingItemId(null);
    }
  }

  if (!me) return null;

  return (
    <section className="player-mesa-panel player-mesa-inventory">
      <div className="player-mesa-section-heading">
        <span className="mesa-eyebrow">MOCHILA</span>
        <strong>Inventário do combate</strong>
      </div>

      {feedback && <p className={`mesa-notice ${feedback.kind === "ok" ? "ok" : "error"}`}>{feedback.message}</p>}

      {inventory.length === 0 ? (
        <p className="mesa-hint">Sem itens na mochila neste combate.</p>
      ) : (
        <ul className="player-mesa-inventory-list">
          {inventory.map((entry) => {
            const itemId = usableId(entry);
            const blocked = itemId ? reasonFor(entry) : "";
            const disabled = busy || usingItemId !== null || !itemId || blocked.length > 0;

            return (
              <li key={itemId ?? entry.item} className="player-mesa-inventory-row">
                <span className="player-mesa-inventory-name">{entry.item}</span>
                <span className="player-mesa-inventory-qty">×{entry.quantity}</span>
                {itemId && (
                  <button
                    type="button"
                    className="mesa-secondary player-mesa-inventory-use"
                    onClick={() => void submitUse(itemId)}
                    disabled={disabled}
                    title={blocked || undefined}
                  >
                    {usingItemId === itemId ? "Usando…" : "Usar"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!gate().ok && <p className="mesa-hint">{gate().message || "Aguarde o seu turno para usar um item."}</p>}
    </section>
  );
}
