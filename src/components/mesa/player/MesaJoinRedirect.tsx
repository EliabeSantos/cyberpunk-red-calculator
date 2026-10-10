"use client";

/**
 * F1.12.6 — **Direct Join**: o convite `/mesa/<CODE>` entrega a tela do Player.
 *
 *     /mesa/8F4K2
 *         ↓
 *     MesaJoinRedirect              ← aqui (este componente)
 *         ├── já sou membro?  → replace /mesa/<sessionId>   (sem rede)
 *         ├── senão          → joinMesa() (o MESMO do dock/modal)
 *         │                     → assinatura no membershipStore
 *         │                     → replace /mesa/<sessionId>
 *         └── falhou?        → erro na tela + volta pra ficha (NUNCA redirect cego)
 *
 *     /mesa/<sessionId>
 *         ↓
 *     PlayerMesaView → PlayerMesaScreen
 *
 * O `joinMesa` é o cliente HTTP de sempre (`POST /api/mesa/join`) e o
 * `membershipStore` é a assinatura de sempre: não existe segundo caminho de
 * entrada, segundo token ou segunda sessão criada aqui. O componente só
 * REMOVE a etapa "abrir o dock" da jornada — o resto é a infraestrutura
 * existente, intocada.
 *
 * O token do jogador vive no `localStorage`, então o join NÃO pode acontecer no
 * servidor: a rota resolve o código (que é público) e este bloco faz a
 * entrada no navegador, onde a identidade já existe.
 *
 * Redirect com `replace`: voltar no histórico não pode devolver o jogador ao
 * convite — ele cairia no mesmo redirect para sempre.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { joinMesa, MesaApiError } from "@/lib/mesa/client";
import { defaultMesaDisplayName } from "@/lib/mesa/displayName";
import {
  describeJoinFailure,
  isMesaSessionId,
  playerMesaHref,
} from "@/lib/mesa/mesaRoute";
import {
  getMembership,
  getMembershipSnapshot,
  getServerMembershipSnapshot,
  removeMembership,
  subscribeToMembership,
} from "@/lib/mesa/membershipStore";

interface Props {
  /** Código normalizado — a rota já passou por `normalizeJoinCode`. */
  joinCode: string;
}

/** Sinais de hidratação: nada muda depois do primeiro render do servidor. */
function emptySubscribe(): () => void {
  return () => {};
}
function hydratedSnapshot(): boolean {
  return true;
}
function serverHydratedSnapshot(): boolean {
  return false;
}

export default function MesaJoinRedirect({ joinCode }: Props) {
  const router = useRouter();

  // Assinatura reativa: é o que faz o redirect acontecer quando o join grava a
  // entrada (noutra aba, ou este mesmo join) — e o que sobrevive ao reload.
  const memberships = useSyncExternalStore(
    subscribeToMembership,
    getMembershipSnapshot,
    getServerMembershipSnapshot,
  );
  const membership = memberships.entries[joinCode.toUpperCase()] ?? null;

  // A assinatura só existe no navegador: até a hidratação o snapshot do
  // membershipStore é vazio por definição, então redirectar antes dela trocaria
  // `/mesa/CODE` por `/mesa/<uuid>` sem checagem nenhuma. `useSyncExternalStore`
  // com `false`/`true` é o marcador de hidratação sem efeito nem `setState`
  // dentro de effect (o próprio padrão do React): `false` no servidor/first
  // render, `true` assim que o cliente assume.
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    hydratedSnapshot,
    serverHydratedSnapshot,
  );

  const [displayName, setDisplayName] = useState(defaultMesaDisplayName);
  const [joining, setJoining] = useState(false);
  const [failure, setFailure] = useState<{ code: string | null; detail: string | null } | null>(null);

  // Assinatura já resolvida (reload, deep link ou segunda aba): vai direto
  // para a tela do Player. `replace` para o convite não virar um beco sem saída
  // no botão "voltar" do navegador.
  const redirectTo = membership && isMesaSessionId(membership.sessionId) ? membership.sessionId : null;
  useEffect(() => {
    if (!redirectTo) return;
    router.replace(playerMesaHref(redirectTo));
  }, [redirectTo, router]);

  /**
   * Assinatura presente mas com `sessionId` que não é uuid: localStorage
   * corrompido (ou gravado por outra versão). Entrar de novo por cima é o
   * caminho de recuperação — o servidor já tem o participante.
   */
  const staleMembership = Boolean(membership) && !redirectTo;

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setJoining(true);
    try {
      // Grava a assinatura no membershipStore e devolve o uuid da sessão.
      const result = await joinMesa({ joinCode, displayName });

      if (!isMesaSessionId(result.session.id)) {
        // O servidor respondeu com algo que não é endereço de Mesa: NÃO navega.
        setFailure({ code: "unknown", detail: "A Mesa respondeu com um endereço inesperado." });
        return;
      }

      // Sem assinatura não há o que autorizar a leitura do estado em
      // `/mesa/<uuid>`: avisar é melhor que mandar o jogador para uma tela que
      // só diria "você não está nesta Mesa".
      const entry = getMembership(joinCode);
      if (!entry || entry.sessionId !== result.session.id) {
        setFailure({
          code: "storage_unavailable",
          detail: "Este navegador não conseguiu guardar a assinatura da Mesa.",
        });
        return;
      }

      router.replace(playerMesaHref(result.session.id));
    } catch (caught) {
      if (caught instanceof MesaApiError) {
        setFailure({ code: caught.code, detail: caught.message });
      } else {
        setFailure({ code: "unknown", detail: null });
      }
    } finally {
      setJoining(false);
    }
  }

  /** Assinatura local corrompida: joga fora e volta ao formulário de entrada. */
  function handleResetSignature() {
    removeMembership(joinCode);
    setFailure(null);
  }

  // Antes da hidratação (ou durante o redirect) não há o que mostrar: um
  // "Entrar" que apareceria e sumiria seria pior do que um instante de espera.
  if (!hydrated || redirectTo) {
    return (
      <main className="player-mesa-page">
        <section className="player-mesa-panel player-mesa-state">
          <span className="mesa-eyebrow">MESA</span>
          <h1>Abrindo a Mesa {joinCode}</h1>
          <p className="mesa-hint">Levando você para a tela da Mesa...</p>
        </section>
      </main>
    );
  }

  if (staleMembership) {
    return (
      <JoinShell joinCode={joinCode}>
        <p className="mesa-error" role="alert">
          A assinatura desta Mesa neste navegador está inconsistente.
        </p>
        <div className="player-mesa-state-actions">
          <button type="button" className="mesa-secondary" onClick={handleResetSignature}>
            Entrar de novo
          </button>
          <Link className="mesa-ghost" href="/ficha">
            Voltar para a ficha
          </Link>
        </div>
      </JoinShell>
    );
  }

  return (
    <JoinShell joinCode={joinCode}>
      {failure && <JoinFailureNotice failure={failure} />}

      <form className="mesa-form" onSubmit={handleJoin}>
        <label>
          Seu nome na mesa
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Zuberi"
            maxLength={40}
            autoComplete="off"
            autoFocus
          />
        </label>
        <button type="submit" className="mesa-primary" disabled={joining || !displayName.trim()}>
          {joining ? "Entrando..." : "[ ENTRAR NA MESA ]"}
        </button>
      </form>

      <Link className="mesa-ghost" href="/ficha">
        ← Voltar para a ficha
      </Link>
    </JoinShell>
  );
}

function JoinShell({ joinCode, children }: { joinCode: string; children: React.ReactNode }) {
  return (
    <main className="player-mesa-page">
      <section className="player-mesa-panel player-mesa-state">
        <span className="mesa-eyebrow">MESA</span>
        <h1>Entrar na mesa {joinCode}</h1>
        <p className="mesa-hint">
          Informe o seu nome para entrar. Nenhuma conta é necessária — o Mestre compartilha só o código.
        </p>
        {children}
      </section>
    </main>
  );
}

function JoinFailureNotice({ failure }: { failure: { code: string | null; detail: string | null } }) {
  const described = describeJoinFailure(failure.code);
  return (
    <div className="mesa-error player-mesa-join-error" role="alert">
      <strong>{described.title}</strong>
      <span>{described.hint}</span>
      {failure.detail && failure.detail !== described.hint && <small>{failure.detail}</small>}
    </div>
  );
}
