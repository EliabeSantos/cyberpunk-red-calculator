"use client";

/**
 * [ INICIAR COMBATE NA MESA ] — o botão de início de combate do modo online,
 * que vive na tela de **⚔️ Encontros** do Mestre, junto do encontro recém-criado.
 *
 * Os inimigos vêm do encontro (mesma fonte que a ficha local do GM usa), então o
 * que o Mestre montou em Encontros é exatamente o que entra na mesa partilhada.
 *
 * Nada é confiado aqui: o servidor (`POST /api/mesa/[id]/combat`) revalida que o
 * pedido veio do Mestre, que a sessão está aberta e que não há combate em curso.
 */

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

import { endCombat, MesaApiError, startCombat } from "@/lib/mesa/client";
import {
  getMembershipSnapshot,
  getServerMembershipSnapshot,
  subscribeToMembership,
} from "@/lib/mesa/membershipStore";

export interface MesaEnemySeed {
  name: string;
  hp: number;
  hpMax: number;
  ref: number;
  /** STAT MOVE do inimigo → o servidor calcula MOVE × 2 metros de orçamento. */
  move: number;
}

interface Props {
  enemies: MesaEnemySeed[];
}

interface GmMesa {
  sessionId: string;
  joinCode: string;
}

/** Mesa deste navegador em que o papel é Mestre (prefere a ativa). */
function findGmMesa(): GmMesa | null {
  const snapshot = getMembershipSnapshot();
  const active = snapshot.activeJoinCode ? snapshot.entries[snapshot.activeJoinCode] : null;
  if (snapshot.activeJoinCode && active?.role === "gm") {
    return { sessionId: active.sessionId, joinCode: snapshot.activeJoinCode };
  }
  const found = Object.entries(snapshot.entries).find(([, entry]) => entry.role === "gm");
  if (!found) return null;
  return { sessionId: found[1].sessionId, joinCode: found[0] };
}

export default function MesaEncounterStart({ enemies }: Props) {
  // Só para reagir a criar/entrar noutra aba: o valor é lido no clique.
  useSyncExternalStore(subscribeToMembership, getMembershipSnapshot, getServerMembershipSnapshot);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; kind: "error" | "ok" } | null>(null);
  const [canRestart, setCanRestart] = useState(false);

  async function handleStart(withRestart: boolean) {
    const mesa = findGmMesa();
    if (!mesa || enemies.length === 0) return;

    setBusy(true);
    setNotice(null);
    setCanRestart(false);
    try {
      if (withRestart) await endCombat(mesa.sessionId);
      await startCombat(mesa.sessionId, enemies);
      setNotice({
        message: `Combate iniciado na mesa ${mesa.joinCode} (${enemies.length} inimigo${enemies.length === 1 ? "" : "s"}).`,
        kind: "ok",
      });
    } catch (caught) {
      if (caught instanceof MesaApiError && caught.code === "combat_already_active") {
        setNotice({
          message: "Esta mesa já tem um combate ativo. Encerre-o para entrar com este encontro.",
          kind: "error",
        });
        setCanRestart(true);
      } else {
        setNotice({
          message: caught instanceof MesaApiError ? caught.message : "Não foi possível iniciar o combate na mesa.",
          kind: "error",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  const mesa = findGmMesa();

  if (!mesa) {
    return (
      <div className="mesa-encounter-start">
        <p className="mesa-hint">
          Para jogar online, crie uma mesa pela ficha (<b>🌐 Mesa online</b>) e volte aqui como Mestre.
        </p>
        <Link className="gm-button gm-button-small" href="/">
          Ir para a ficha
        </Link>
      </div>
    );
  }

  return (
    <div className="mesa-encounter-start">
      <button
        type="button"
        className="gm-button gm-button-small"
        disabled={busy || enemies.length === 0}
        onClick={() => void handleStart(false)}
      >
        ⚔ Iniciar combate na Mesa
      </button>

      {canRestart && (
        <button
          type="button"
          className="gm-button gm-button-small"
          disabled={busy}
          onClick={() => void handleStart(true)}
        >
          Encerrar e reiniciar com este encontro
        </button>
      )}

      {notice && <p className={`mesa-notice ${notice.kind}`}>{notice.message}</p>}
      {notice?.kind === "ok" && (
        <Link className="mesa-ghost" href={`/mesa/${mesa.joinCode}`}>
          Ver a Mesa agora →
        </Link>
      )}
      <span className="mesa-encounter-start-code">Mesa {mesa.joinCode}</span>
    </div>
  );
}
