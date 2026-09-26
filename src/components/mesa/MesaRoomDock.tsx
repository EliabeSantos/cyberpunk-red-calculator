"use client";

/**
 * Sala da Mesa como PAINEL sobre a tela principal.
 *
 * A mesa não é mais uma rota própria: o jogador continua na ficha e a sala
 * aparece como um overlay por cima. O código de convite /mesa/CODE só muda a
 * URL — o conteúdo é a mesma tela principal com este painel já aberto.
 *
 * O estado vem de `mesaUiStore` (aberto pelo nav) + `initialJoinCode` (convite).
 * Tudo é derivado no render, então não existe flash nem divergência de
 * hidratação — servidor e cliente primeiro render são iguais.
 *
 * IMPORTANTE: **fechar o painel não desconecta**. A conexão é a assinatura no
 * `membershipStore`, que vive enquanto o jogador não clicar em "Sair da mesa"
 * ou o Mestre não encerrar a sessão. Este componente só faz uma conferência
 * de cortesia ao montar (a sessão pode ter acabado com a página fechada).
 */

import { useEffect, useState, useSyncExternalStore } from "react";

import MesaRoom from "@/components/mesa/MesaRoom";
import { fetchMesaState, MesaApiError } from "@/lib/mesa/client";
import { listMemberships, removeMembership } from "@/lib/mesa/membershipStore";
import {
  closeMesa,
  getMesaUiSnapshot,
  getServerMesaUiSnapshot,
  subscribeToMesaUi,
} from "@/lib/mesa/mesaUiStore";

interface Props {
  /** Código vindo do link de convite /mesa/CODE (rota que monta a tela principal). */
  initialJoinCode?: string;
}

/** Erros que significam "este navegador não é mais participante". */
const STALE_CODES = new Set(["not_participant", "session_not_found", "session_finished"]);

export default function MesaRoomDock({ initialJoinCode }: Props) {
  const ui = useSyncExternalStore(subscribeToMesaUi, getMesaUiSnapshot, getServerMesaUiSnapshot);
  // Fechou o convite (sem navegar): não reabre mais enquanto estiver nesta URL.
  const [dismissedInvite, setDismissedInvite] = useState(false);

  // Conferência única ao abrir a tela: se a sessão acabou (ou este navegador
  // já saiu) enquanto a página estava fechada, a assinatura local morre aqui —
  // o botão do nav nunca continua aceso numa mesa que já não existe.
  // Falha de rede NÃO desconecta: o vínculo só cai por pedido ou por decisão
  // do servidor.
  useEffect(() => {
    let disposed = false;
    const entries = listMemberships();

    void (async () => {
      for (const entry of entries) {
        if (disposed) return;
        try {
          const state = await fetchMesaState(entry.sessionId);
          if (disposed) return;
          if (state.session.status === "finished") removeMembership(entry.joinCode);
        } catch (caught) {
          if (disposed || !(caught instanceof MesaApiError)) continue;
          if (STALE_CODES.has(caught.code)) removeMembership(entry.joinCode);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  const joinCode = ui.joinCode ?? initialJoinCode ?? null;
  const open = ui.open || (Boolean(initialJoinCode) && !dismissedInvite);

  if (!open || !joinCode) return null;

  function handleDismiss() {
    closeMesa();
    if (initialJoinCode) setDismissedInvite(true);
  }

  return (
    <div
      className="mesa-dock-backdrop"
      onClick={handleDismiss}
      role="presentation"
    >
      <div
        className="mesa-dock"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Mesa online"
      >
        <MesaRoom joinCode={joinCode} onClose={handleDismiss} />
      </div>
    </div>
  );
}
