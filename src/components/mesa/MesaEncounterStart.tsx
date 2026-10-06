"use client";

/**
 * [ INICIAR COMBATE NA MESA ] — o botão de início de combate do modo online,
 * que vive na tela de **⚔️ Encontros** do Mestre, junto do encontro recém-criado.
 *
 * Os inimigos vêm do encontro (mesma fonte que a ficha local do GM usa), então o
 * que o Mestre montou em Encontros é exatamente o que entra na mesa partilhada.
 *
 * O encontro viaja junto (`encounter`): no servidor ele nasce ligado à partida
 * em `mesa_battles`, o que torna o encontro **de uso único** — já lançado uma
 * vez, ele não começa outra luta em mesa nenhuma (decisão de 27/09/2026). Daqui
 * sai o vínculo (`onStarted`), que o encontro guarda no localStorage.
 *
 * Nada é confiado aqui: o servidor (`POST /api/mesa/[id]/combat`) revalida que o
 * pedido veio do Mestre, que a sessão está aberta, que não há combate em curso
 * e que o encontro não foi usado.
 */

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

import { endCombat, MesaApiError, startCombat } from "@/lib/mesa/client";
import {
  getMembershipSnapshot,
  getServerMembershipSnapshot,
  subscribeToMembership,
} from "@/lib/mesa/membershipStore";
import type { EncounterBattle } from "@/lib/gmStorage";
import type { EncounterParticipant } from "@/types/encounter";

export interface MesaEnemySeed {
  name: string;
  hp: number;
  hpMax: number;
  ref: number;
  /** STAT MOVE do inimigo → o servidor calcula MOVE × 2 metros de orçamento. */
  move: number;
  /**
   * Bônus de Iniciativa vindo dos implantes do inimigo (Sandevistan, Kerenzikov).
   * A mesa rola `1d10 + REF + bônus` para ele — mesma conta da tela de Encontros.
   */
  initiativeBonus?: number;
  /**
   * Identidade estável do participante do encontro — vira `source_key` na mesa
   * e é por ela que o HP aplicado em Encontros acha a linha certa aqui.
   * Opcional: sem ela o inimigo entra normalmente, só não espelha vida.
   */
  key?: string;
  /**
   * Mochila do inimigo — pente e reserva (munição + itens de cura), tal como
   * estão no encontro. A mesa só EXPOE o estado (`mesa_combatants.supplies`);
   * quem rola ataque, recarrega e cura continua sendo a tela de Encontros.
   */
  supplies?: {
    /** Balas no pente agora; ausente quando a arma não tem pente. */
    ammo?: number;
    /** Capacidade do pente. */
    magazine?: number;
    /** Reserva na mochila: munição para recarregar e itens de cura. */
    inventory?: Array<{ item: string; quantity: number }>;
  };
  /** Dados do encontro que o servidor transforma em snapshot de combate. */
  snapshot?: EncounterParticipant;
}

interface Props {
  enemies: MesaEnemySeed[];
  /** Encontro de origem — define o vínculo de uso único no servidor. */
  encounter?: { id: string; name: string };
  /** Vínculo já existente deste encontro com uma partida. */
  battle?: EncounterBattle | null;
  /** Chamado quando o combate sobe: o pai grava o vínculo no encontro. */
  onStarted?: (battle: EncounterBattle) => void;
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

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("pt-BR");
}

export default function MesaEncounterStart({ enemies, encounter, battle, onStarted }: Props) {
  // Só para reagir a criar/entrar noutra aba: o valor é lido no clique.
  useSyncExternalStore(subscribeToMembership, getMembershipSnapshot, getServerMembershipSnapshot);
  const [busy, setBusy] = useState(false);
  const [gmParticipation, setGmParticipation] = useState<"character" | "gm_only">("character");

  async function handleStart(mode: "start" | "restart") {
    const mesa = findGmMesa();
    if (!mesa || enemies.length === 0) return;

    setBusy(true);
    try {
      if (mode === "restart") {
        try {
          // Mesma partida ainda ativa aqui → o servidor recomeça sem fechar.
          await startCombat(mesa.sessionId, enemies, { encounter, restart: true, gmParticipation });
        } catch (caught) {
          // Quem tem o combate ativo é OUTRO encontro: encerra e entra com este.
          if (caught instanceof MesaApiError && caught.code === "combat_already_active") {
            await endCombat(mesa.sessionId);
            await startCombat(mesa.sessionId, enemies, encounter ? { encounter, gmParticipation } : { gmParticipation });
          } else {
            throw caught;
          }
        }
      } else {
        await startCombat(mesa.sessionId, enemies, encounter ? { encounter, gmParticipation } : { gmParticipation });
      }

      onStarted?.({
        sessionId: mesa.sessionId,
        joinCode: mesa.joinCode,
        status: "active",
        startedAt: new Date().toISOString(),
      });
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

  // Encontro já concluído: nunca mais inicia combate em mesa nenhuma.
  if (battle?.status === "completed") {
    return (
      <div className="mesa-encounter-start">
        <p className="mesa-encounter-start-done" role="status">
          ✅ Encontro concluído{formatDate(battle.completedAt) ? ` em ${formatDate(battle.completedAt)}` : ""} — já
          registrou sua partida e não pode ser lançado de novo.
        </p>
        <span className="mesa-encounter-start-code">Mesa {battle.joinCode}</span>
      </div>
    );
  }

  // Em combate noutra mesa: o encontro não pode rodar em dois lugares.
  if (battle?.status === "active" && battle.sessionId !== mesa.sessionId) {
    return (
      <div className="mesa-encounter-start">
        <p className="mesa-encounter-start-busy" role="status">
          ⚔ Este encontro já está em combate na Mesa {battle.joinCode}.
        </p>
        <Link className="mesa-ghost" href={`/mesa/${battle.joinCode}`}>
          Abrir essa Mesa →
        </Link>
      </div>
    );
  }

  const restartHere = battle?.status === "active";

  return (
    <div className="mesa-encounter-start">
      <fieldset className="mesa-gm-participation">
        <legend>Participação do Mestre</legend>
        <label>
          <input
            type="radio"
            name="gm-participation"
            value="gm_only"
            checked={gmParticipation === "gm_only"}
            onChange={() => setGmParticipation("gm_only")}
            disabled={busy}
          />
          GM only — controlar inimigos
        </label>
        <label>
          <input
            type="radio"
            name="gm-participation"
            value="character"
            checked={gmParticipation === "character"}
            onChange={() => setGmParticipation("character")}
            disabled={busy}
          />
          Usar meu personagem
        </label>
      </fieldset>
      <button
        type="button"
        className="gm-button gm-button-small mesa-start-primary"
        disabled={busy || enemies.length === 0}
        onClick={() => void handleStart(restartHere ? "restart" : "start")}
      >
        {restartHere ? "🔄 Reiniciar combate na Mesa" : "⚔ Iniciar combate na Mesa"}
      </button>
    </div>
  );
}
