/**
 * Transporte local de invalidações.
 *
 * É deliberadamente somente um barramento em memória do processo: nenhum
 * snapshot, token, papel ou estado privado atravessa este canal. O cliente
 * sempre reconcilia por GET autenticado e mantém polling como fallback.
 */
import type {
  MesaEventSubscription,
  MesaEventTransport,
  MesaInvalidation,
} from "@/lib/mesa/infrastructure";

interface LocalSubscriber {
  readonly onInvalidate: (event: MesaInvalidation) => void;
  readonly onStatus?: (status: string) => void;
  active: boolean;
}

type SubscriberSet = Set<LocalSubscriber>;

const globalForLocalEvents = globalThis as unknown as {
  mesaLocalEventSubscribers?: Map<string, SubscriberSet>;
};

function subscribers(): Map<string, SubscriberSet> {
  return globalForLocalEvents.mesaLocalEventSubscribers ??= new Map();
}

function validSessionId(sessionId: string): boolean {
  return typeof sessionId === "string" && sessionId.trim().length > 0;
}

export class LocalMesaEventTransport implements MesaEventTransport {
  async publishInvalidation(sessionId: string): Promise<void> {
    if (!validSessionId(sessionId)) return;
    const listeners = subscribers().get(sessionId);
    if (!listeners || listeners.size === 0) return;

    // Snapshot the set so close() durante uma entrega não altera a iteração.
    const event = Object.freeze({ sessionId, publishedAt: Date.now() }) as MesaInvalidation;
    for (const listener of [...listeners]) {
      if (!listener.active) continue;
      try {
        listener.onInvalidate(event);
      } catch {
        // Um cliente defeituoso não pode impedir os demais. O cliente afetado
        // continua com polling/reconciliação como fonte de recuperação.
        try { listener.onStatus?.("CHANNEL_ERROR"); } catch { /* isolamento */ }
      }
    }
  }

  subscribeInvalidation(
    sessionId: string,
    onInvalidate: (event: MesaInvalidation) => void,
    onStatus?: (status: string) => void,
  ): MesaEventSubscription | null {
    if (!validSessionId(sessionId)) return null;
    const listener: LocalSubscriber = { onInvalidate, onStatus, active: true };
    const map = subscribers();
    const listeners = map.get(sessionId) ?? new Set<LocalSubscriber>();
    listeners.add(listener);
    map.set(sessionId, listeners);
    try { onStatus?.("SUBSCRIBED"); } catch { /* callback externo */ }

    let closed = false;
    return {
      close: () => {
        if (closed) return;
        closed = true;
        listener.active = false;
        listeners.delete(listener);
        if (listeners.size === 0) map.delete(sessionId);
        try { onStatus?.("CLOSED"); } catch { /* callback externo */ }
      },
    };
  }
}
