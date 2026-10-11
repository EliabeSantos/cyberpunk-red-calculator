"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { loadCharacters } from "@/lib/storage";
import { loadRemoteCharacters } from "@/lib/toolkitClient";
import type { Character } from "@/types/character";

export default function LandingPage() {
  const [characters, setCharacters] = useState<Character[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => setCharacters(loadCharacters()), 0);
    void loadRemoteCharacters().then(setCharacters).catch(() => undefined);
    return () => window.clearTimeout(timer);
  }, []);

  const active = characters[0] ?? null;

  return (
    <main className="landing-shell">
      <nav className="landing-nav">
        <Link href="/" className="landing-mark"><span>◆</span> CYBERPUNK RED / TOOLKIT</Link>
        <div className="landing-nav-actions">
          <Link href="/ficha">Fichas</Link>
          <Link href="/gm">Área do Mestre</Link>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-copy">
          <p className="landing-kicker">Ferramenta de campanha para Night City</p>
          <h1>Entre na cidade.<br /><em>Deixe uma marca.</em></h1>
          <p className="landing-intro">Crie personagens, acompanhe cada ferimento e leve sua ficha para a Mesa sem perder o fio da história.</p>
          <div className="landing-ctas">
            <Link href="/ficha/criar" className="landing-primary">Criar uma ficha</Link>
            {active ? <Link href="/ficha" className="landing-secondary">Abrir {active.identity.name || "minha ficha"}</Link> : <span className="landing-secondary landing-disabled">Nenhuma ficha salva</span>}
          </div>
        </div>

        <div className="landing-console" aria-label="Resumo do Toolkit">
          <div className="landing-console-top"><span>SESSION / READY</span><i aria-hidden="true" /></div>
          <div className="landing-console-art"><span className="landing-crosshair" aria-hidden="true">+</span><strong>YOUR STORY<br />IS STILL<br /><b>LOADING</b></strong><small>NO PRESET HEROES DETECTED</small></div>
          <div className="landing-console-footer"><span>FICHAS LOCAIS</span><strong>{characters.length.toString().padStart(2, "0")}</strong></div>
        </div>
      </section>

      <section className="landing-ways" aria-label="Caminhos do Toolkit">
        <article><span className="landing-line" /><h2>Uma ficha que acompanha a evolução</h2><p>Perícias, cyberware, humanidade, inventário e histórico ficam juntos, prontos para a próxima sessão.</p></article>
        <article><span className="landing-line landing-line-coral" /><h2>Uma Mesa que sabe quem manda</h2><p>Entre por convite, conecte sua ficha e jogue com o combate autoritativo da campanha.</p></article>
        <article><span className="landing-line landing-line-blue" /><h2>Seu arquivo, seu controle</h2><p>Exporte a ficha inteira para guardar, transportar ou abrir em outra sessão.</p></article>
      </section>
    </main>
  );
}
