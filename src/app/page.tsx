import Link from "next/link";
import CharacterToolkit from "@/components/character/CharacterToolkit";

export default function Home() {
  return (
    <>
      <nav className="home-nav">
        <Link href="/gm" className="gm-entry-button">
          🎭 Área do Mestre
        </Link>
        <Link href="/gm/encounters" className="gm-entry-button gm-entry-button-alt">
          ⚔️ Encontros
        </Link>
      </nav>
      <CharacterToolkit />
    </>
  );
}