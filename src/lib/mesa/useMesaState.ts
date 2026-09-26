"use client";

/**
 * Sincroniza o estado da mesa com o navegador.
 *
 * Estratégia em duas camadas:
 *   1. Supabase Realtime (canal `mesa:<id>`) → atualização instantânea;
 *   2. polling de segurança a cada 4s         → cobre Realtime indisponível
 *      (env pública ausente, projeto sem Realtime, rede instável).
 *
 * O snapshot vem SEMPRE do servidor validado; o cliente só desenha.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchMesaState, MesaApiError } from "@/lib/mesa/client";
import { subscribeMesaState, type MesaSnapshot } from "@/lib/mesa/realtime";
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
  refresh: () => Promise<void>;
}

export function useMesaState(sessionId: string | null): MesaStateResult {
  const [state, setState] = useState<MesaState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [realtime, setRealtime] = useState(false);

  const realtimeActiveRef = useRef(false);

  const applySnapshot = useCallback((snapshot: MesaSnapshot) => {
    // O broadcast não traz `viewer` (é igual para todos, exceto quem pergunta):
    // preserva o do último GET para os botões continuarem certos.
    setState((previous) => ({
      ...snapshot,
      viewer: previous?.viewer ?? { participantId: null, role: null, displayName: null },
    }));
    setError(null);
    setErrorCode(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const next = await fetchMesaState(sessionId);
      setState(next);
      setError(null);
      setErrorCode(null);
    } catch (caught) {
      setError(caught instanceof MesaApiError ? caught.message : "Falha ao atualizar a mesa.");
      setErrorCode(caught instanceof MesaApiError ? caught.code : "unknown");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    // O estado inicial já é `{ state: null, loading: true }`; não há nada a
    // redefinir aqui — só sair cedo quando não há mesa para observar.
    if (!sessionId) return;

    let disposed = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let subscription: { close: () => void } | null = null;

    const stopPolling = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const startPolling = () => {
      if (pollTimer || disposed) return;
      const tick = async () => {
        if (disposed) return;
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
        setState(next);
        setError(null);
        setErrorCode(null);
      } catch (caught) {
        if (!disposed) {
          setError(caught instanceof MesaApiError ? caught.message : "Falha ao carregar a mesa.");
          setErrorCode(caught instanceof MesaApiError ? caught.code : "unknown");
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void bootstrap().then(() => {
      if (disposed) return;
      subscription = subscribeMesaState(
        sessionId,
        (snapshot) => {
          if (disposed) return;
          realtimeActiveRef.current = true;
          setRealtime(true);
          stopPolling();
          applySnapshot(snapshot);
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
  }, [sessionId, applySnapshot, refresh]);

  return { state, loading, error, errorCode, realtime, refresh };
}
