import type { Metadata } from "next";
import Link from "next/link";

import MesaJoinRedirect from "@/components/mesa/player/MesaJoinRedirect";
import PlayerMesaView from "@/components/mesa/PlayerMesaView";
import { resolveMesaRoute } from "@/lib/mesa/mesaRoute";

export const metadata: Metadata = {
  title: "Mesa | Cyberpunk RED Toolkit",
  description: "Experiência do jogador na Mesa online de Cyberpunk RED.",
};

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * A rota `/mesa/[id]` atende a sessão E o convite legado no mesmo segmento —
 * o Next não permite duas rotas dinâmicas irmãs (`[id]` e `[joinCode]`
 * colidiriam), e criar a segunda quebra o build.
 *
 *   /mesa/<uuid> → tela do Player (`PlayerMesaView`);
 *   /mesa/<CODE> → entrada direta: o navegador entra pelo código com o
 *                  `joinMesa` de sempre e é levado para o `/mesa/<uuid>` acima.
 *
 * O redirecionamento acontece no navegador porque o `playerToken` vive no
 * `localStorage` — o servidor não tem como entrar na mesa por este jogador, e
 * inventar uma identidade aqui criaria um segundo caminho de autenticação.
 * Convites legados que ainda não são códigos não viram sessão: viram erro
 * explícito, nunca a ficha em silêncio.
 */
export default async function MesaSessionPage({ params }: Props) {
  const { id } = await params;
  const target = resolveMesaRoute(id);

  if (target.kind === "session") return <PlayerMesaView sessionId={target.sessionId} />;
  if (target.kind === "invite") return <MesaJoinRedirect joinCode={target.joinCode} />;

  return (
    <main className="player-mesa-page">
      <section className="player-mesa-panel player-mesa-state">
        <span className="mesa-eyebrow">MESA</span>
        <h1>Endereço de Mesa inválido</h1>
        <p className="mesa-hint">
          <code>{target.segment || "(vazio)"}</code> não é um código de convite (5 caracteres) nem o identificador
          de uma Mesa. Confira o link que o Mestre compartilhou.
        </p>
        <div className="player-mesa-state-actions">
          <Link className="mesa-ghost" href="/">
            Voltar para a ficha
          </Link>
        </div>
      </section>
    </main>
  );
}
