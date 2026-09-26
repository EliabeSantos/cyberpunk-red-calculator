import type { Metadata } from "next";

import CharacterToolkit from "@/components/character/CharacterToolkit";
import { normalizeJoinCode } from "@/lib/mesa/joinCode";

export const metadata: Metadata = {
  title: "Mesa | Cyberpunk RED Toolkit",
  description: "Mesa online compartilhada de Cyberpunk RED.",
};

interface Props {
  params: Promise<{ joinCode: string }>;
}

/**
 * Link de convite: /mesa/8F4K2.
 *
 * NÃO é uma tela separada: renderiza a MESMA tela principal (ficha) da rota `/`,
 * só que com o painel da mesa já aberto por cima. O jogador entra pela URL de
 * convite e continua na sessão principal — fechar o painel devolve a ficha.
 *
 * Código inválido cai na tela principal sem painel (o jogador usa o botão
 * 🌐 Mesa online do nav para digitar o código na mão).
 */
export default async function MesaPage({ params }: Props) {
  const { joinCode } = await params;
  const normalized = normalizeJoinCode(joinCode);
  return <CharacterToolkit initialJoinCode={normalized ?? undefined} />;
}
