"use client";

/**
 * Sincroniza o estado da mesa com o navegador.
 *
 * Estratégia em duas camadas:
 *   1. Supabase Realtime (canal `mesa:<id>`) → atualização instantânea;
 *   2. polling de segurança a cada 4s         → cobre Realtime indisponível
 *      (env pública ausente, projeto sem Realtime, rede instável).
 *
 * O snapshot vem SEMPRE do GET server-side validado; o Realtime só invalida
 * cache e o cliente então busca a projeção própria do viewer.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchMesaState, MesaApiError } from "@/lib/mesa/client";
import { subscribeMesaState, type MesaSnapshot } from "@/lib/mesa/realtime";
import { markMesaRefresh, markMesaRealtimeDelivery } from "@/lib/mesa/telemetry";
import type { MesaState } from "@/lib/mesa/types";

const POLL_INTERVAL_MS = 4000;
const REALTIME_GRACE_MS = 5000;

export interface MesaStateResult {
  state: MesaState | null;
  loading: boolean;
  error: string | null;
  /** Código técnico do último erro (ex.: `not_participant`) — a UI decide o que fazer. */
  errorCode: string | null;
  /** `true` quando o Realtime está entregando; `false` = modo polling. */
  realtime: boolean;
  refresh: (force?: boolean) => Promise<void>;
  /** Incrementa quando um GET autenticado aplica um snapshot. */
  refreshVersion: number;
  getRefreshVersion: () => number;
}

/** Aceita somente snapshots da sessão atual e nunca recua a versão conhecida. */
export function shouldAcceptMesaSnapshot(
  snapshot: { session: Pick<MesaSnapshot["session"], "id">; stateVersion?: string },
  expectedSessionId: string,
  latestVersion: string | null,
): boolean {
  if (snapshot.session.id !== expectedSessionId) return false;
  if (latestVersion && !snapshot.stateVersion) return false;
  if (snapshot.stateVersion && latestVersion && snapshot.stateVersion < latestVersion) return false;
  return true;
}

/** Só há necessidade de reconciliação explícita quando nenhum snapshot chegou. */
export function shouldReconcileAfterAction(versionBefore: number, versionAfter: number): boolean {
  return versionBefore === versionAfter;
}

export function useMesaState(sessionId: string | null): MesaStateResult {
  const [state, setState] = useState<MesaState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [realtime, setRealtime] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);

  const realtimeActiveRef = useRef(false);
  const latestVersionRef = useRef<string | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const refreshVersionRef = useRef(0);
  const terminalErrorRef = useRef(false);

  const acceptsSnapshot = useCallback((snapshot: MesaSnapshot, expectedSessionId: string): boolean => {
    if (!shouldAcceptMesaSnapshot(snapshot, expectedSessionId, latestVersionRef.current)) return false;
    const incoming = snapshot.stateVersion;
    if (incoming) latestVersionRef.current = incoming;
    return true;
  }, []);

  const applySnapshot = useCallback((snapshot: MesaSnapshot, expectedSessionId: string) => {
    if (!acceptsSnapshot(snapshot, expectedSessionId)) return false;
    // Mantido para compatibilidade com snapshots antigos; o Realtime atual só
    // envia invalidação e nunca chama este caminho com dados de combatants.
    setState((previous) => ({
      ...snapshot,
      viewer: previous?.session.id === snapshot.session.id
        ? previous.viewer
        : { participantId: null, role: null, displayName: null },
    }));
    setError(null);
    setErrorCode(null);
    return true;
  }, [acceptsSnapshot]);

  const refresh = useCallback(async (force = false) => {
    if (!sessionId) return;
    if (terminalErrorRef.current && !force) return;
    if (force) terminalErrorRef.current = false;
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const startedAt = performance.now();
    markMesaRefresh({ sessionId, stage: "T9" });
    const operation = (async () => {
      try {
        const next = await fetchMesaState(sessionId);
        markMesaRefresh({ sessionId, stage: "T10", durationMs: performance.now() - startedAt });
        if (acceptsSnapshot(next, sessionId)) {
          setState(next);
          refreshVersionRef.current += 1;
          setRefreshVersion(refreshVersionRef.current);
          markMesaRefresh({ sessionId, stage: "T12", stateVersion: next.stateVersion });
        }
        setError(null);
        setErrorCode(null);
      } catch (caught) {
        const code = caught instanceof MesaApiError ? caught.code : "unknown";
        const terminal = caught instanceof MesaApiError && [
          "missing_token",
          "not_participant",
          "session_not_found",
          "session_finished",
        ].includes(caught.code);
        if (terminal) {
          terminalErrorRef.current = true;
          setState(null);
        }
        setError(caught instanceof MesaApiError ? caught.message : "Falha ao atualizar a mesa.");
        setErrorCode(code);
      } finally {
        setLoading(false);
      }
    })();
    refreshPromiseRef.current = operation;
    try {
      await operation;
    } finally {
      refreshPromiseRef.current = null;
    }
  }, [sessionId, acceptsSnapshot]);

  useEffect(() => {
    // O estado inicial já é `{ state: null, loading: true }`; não há nada a
    // redefinir aqui — só sair cedo quando não há mesa para observar.
    if (!sessionId) return;

    let disposed = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let subscription: { close: () => void } | null = null;
    latestVersionRef.current = null;
    terminalErrorRef.current = false;

    const stopPolling = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const startPolling = () => {
      if (pollTimer || disposed) return;
      const tick = async () => {
        if (disposed || terminalErrorRef.current) return;
        if (!realtimeActiveRef.current) await refresh();
        pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
      };
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    realtimeActiveRef.current = false;

    // A primeira carga roda como uma tarefa assíncrona: o `setState` só acontece
    // depois do `await`, então o efeito não dispara renderação em cascata.
    const bootstrap = async () => {
      try {
        const next = await fetchMesaState(sessionId);
        if (disposed) return;
        if (!acceptsSnapshot(next, sessionId)) return;
        setState(next);
        refreshVersionRef.current += 1;
        setRefreshVersion(refreshVersionRef.current);
        setError(null);
        setErrorCode(null);
      } catch (caught) {
        if (!disposed) {
          const code = caught instanceof MesaApiError ? caught.code : "unknown";
          const terminal = caught instanceof MesaApiError && [
            "missing_token",
            "not_participant",
            "session_not_found",
            "session_finished",
          ].includes(caught.code);
          if (terminal) terminalErrorRef.current = true;
          setError(caught instanceof MesaApiError ? caught.message : "Falha ao carregar a mesa.");
          setErrorCode(code);
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void bootstrap().then(() => {
      if (disposed) return;
      subscription = subscribeMesaState(
        sessionId,
         () => {
           // O Realtime atual publica somente invalidação; o GET autenticado
           // abaixo é a única fonte do snapshot aplicado à tela.
         },
        (status) => {
          if (disposed) return;
          if (status === "SUBSCRIBED") {
            realtimeActiveRef.current = true;
            setRealtime(true);
            stopPolling();
            // Estado pode ter mudado entre o GET e a assinatura.
            void bootstrap();
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            realtimeActiveRef.current = false;
            setRealtime(false);
            startPolling();
          }
         },
         (invalidation) => {
           if (disposed) return;
           realtimeActiveRef.current = true;
           setRealtime(true);
           stopPolling();
           markMesaRealtimeDelivery(sessionId, invalidation.publishedAt);
            // O callback não aplica dados do canal; somente dispara o GET autenticado.
            void refresh();
         },
       );

      if (!subscription) {
        // Sem Realtime disponível: já cai no polling.
        startPolling();
      } else {
        // Se em 5s o canal não confirmar, passa a consultar por GET.
        graceTimer = setTimeout(() => {
          if (!disposed && !realtimeActiveRef.current) startPolling();
        }, REALTIME_GRACE_MS);
      }
    });

    return () => {
      disposed = true;
      if (graceTimer) clearTimeout(graceTimer);
      stopPolling();
      realtimeActiveRef.current = false;
      subscription?.close();
    };
  }, [sessionId, acceptsSnapshot, applySnapshot, refresh]);

  // Marca o primeiro ponto pós-render observável no cliente. Isso mede o
  // caminho até o commit do hook, não uma pintura específica de cada pixel.
  useEffect(() => {
    if (state?.session.id === sessionId) markMesaRefresh({ sessionId, stage: "T13" });
  }, [sessionId, state]);

  // Enquanto uma nova sessão carrega, nunca exponha o snapshot da sessão
  // anterior como se fosse o atual.
  const visibleState = state?.session.id === sessionId ? state : null;
  const getRefreshVersion = useCallback(() => refreshVersionRef.current, []);
  return { state: visibleState, loading, error, errorCode, realtime, refresh, refreshVersion, getRefreshVersion };
}
