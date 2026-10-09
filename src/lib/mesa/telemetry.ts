"use client";

import { createId } from "@/lib/id";

/** Instrumentação local, sem payload de domínio ou dependência externa. */
export interface MesaTelemetryEvent {
  traceId: string;
  action: string;
  sessionId?: string;
  resolutionId?: string;
  stage: string;
  at: number;
  durationMs?: number;
  stateVersion?: string;
  success?: boolean;
}

const pendingBySession = new Map<string, { traceId: string; action: string; startedAt: number; resolutionId?: string }>();
const events: MesaTelemetryEvent[] = [];

function safeSessionId(sessionId: string): string {
  return sessionId.length <= 8 ? sessionId : sessionId.slice(0, 8);
}

function emit(event: MesaTelemetryEvent): void {
  events.push(event);
  if (events.length > 200) events.splice(0, events.length - 200);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("mesa:telemetry", { detail: event }));
    if (process.env.NODE_ENV !== "production") console.debug("[mesa-telemetry]", event);
  }
}

export function startMesaTelemetry(input: { action: string; sessionId?: string; resolutionId?: string }): string {
  const traceId = createId();
  const startedAt = performance.now();
  const event = {
    traceId,
    action: input.action,
    ...(input.sessionId ? { sessionId: safeSessionId(input.sessionId) } : {}),
    ...(input.resolutionId ? { resolutionId: input.resolutionId } : {}),
    stage: "T0",
    at: Date.now(),
  } satisfies MesaTelemetryEvent;
  emit(event);
  // GETs de reconciliação não representam uma nova ação. Não substitua o
  // pending da intenção original, pois ele é necessário para correlacionar a
  // confirmação visual pelo mesmo resolutionId.
  if (input.sessionId && input.resolutionId) {
    pendingBySession.set(input.sessionId, { traceId, action: input.action, startedAt, resolutionId: input.resolutionId });
  }
  return traceId;
}

export function markMesaTelemetry(
  traceId: string,
  input: Omit<MesaTelemetryEvent, "traceId" | "at"> & { at?: number },
): void {
  emit({ traceId, at: input.at ?? Date.now(), ...input });
}

export function finishMesaTelemetry(traceId: string, success: boolean): void {
  const pending = [...pendingBySession.values()].find((value) => value.traceId === traceId);
  markMesaTelemetry(traceId, { action: pending?.action ?? "unknown", stage: "complete", success });
}

/** Chamado quando uma invalidação Realtime chega; o snapshot continua vindo por GET autenticado. */
export function markMesaRealtimeDelivery(sessionId: string, publishedAt?: number): void {
  const pending = pendingBySession.get(sessionId);
  if (!pending) return;
  markMesaTelemetry(pending.traceId, {
    action: pending.action,
    stage: "T8",
    durationMs: performance.now() - pending.startedAt,
    sessionId: safeSessionId(sessionId),
    ...(pending.resolutionId ? { resolutionId: pending.resolutionId } : {}),
  });
  if (typeof publishedAt === "number") {
    markMesaTelemetry(pending.traceId, {
      action: pending.action,
      stage: "T8.transport",
      durationMs: Math.max(0, Date.now() - publishedAt),
      sessionId: safeSessionId(sessionId),
      ...(pending.resolutionId ? { resolutionId: pending.resolutionId } : {}),
    });
  }
}

export function markMesaRefresh(input: { sessionId: string; stage: string; durationMs?: number; stateVersion?: string }): void {
  const pending = pendingBySession.get(input.sessionId);
  if (!pending) return;
  markMesaTelemetry(pending.traceId, {
    action: pending.action,
    stage: input.stage,
    durationMs: input.durationMs ?? performance.now() - pending.startedAt,
    sessionId: safeSessionId(input.sessionId),
    ...(pending.resolutionId ? { resolutionId: pending.resolutionId } : {}),
    ...(input.stateVersion ? { stateVersion: input.stateVersion } : {}),
  });
  // T13 é emitido pelo efeito que observa o snapshot já aplicado ao React.
  // Para uma ação com resolutionId, esse é o ponto visual confirmado; o GET
  // terminou antes dele, mas não é confundido com a renderização final.
  if (input.stage === "T13" && pending.resolutionId) {
    markMesaVisualConfirmation({ sessionId: input.sessionId, resolutionId: pending.resolutionId });
  }
}

/** Confirma que a projeção autoritativa desta ação chegou à UI. */
export function markMesaVisualConfirmation(input: { sessionId: string; resolutionId: string }): void {
  const pending = pendingBySession.get(input.sessionId);
  if (!pending || pending.resolutionId !== input.resolutionId) return;
  markMesaTelemetry(pending.traceId, {
    action: pending.action,
    stage: "visual_confirmed",
    durationMs: performance.now() - pending.startedAt,
    sessionId: safeSessionId(input.sessionId),
    resolutionId: input.resolutionId,
  });
  pendingBySession.delete(input.sessionId);
}

export function listMesaTelemetry(): readonly MesaTelemetryEvent[] {
  return events;
}
