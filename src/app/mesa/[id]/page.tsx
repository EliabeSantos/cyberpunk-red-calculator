import type { Metadata } from "next";

import CharacterToolkit from "@/components/character/CharacterToolkit";
import PlayerMesaView from "@/components/mesa/PlayerMesaView";
import { normalizeJoinCode } from "@/lib/mesa/joinCode";

export const metadata: Metadata = {
  title: "Mesa | Cyberpunk RED Toolkit",
  description: "Experiência do jogador na Mesa online de Cyberpunk RED.",
};

interface Props {
  params: Promise<{ id: string }>;
}

function isSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * A rota dinâmica mantém os convites legados e também atende sessões por UUID.
 * O Next não permite duas rotas dinâmicas irmãs com o mesmo padrão.
 */
export default async function MesaSessionPage({ params }: Props) {
  const { id } = await params;
  if (isSessionId(id)) return <PlayerMesaView sessionId={id} />;
  return <CharacterToolkit initialJoinCode={normalizeJoinCode(id) ?? undefined} />;
}
