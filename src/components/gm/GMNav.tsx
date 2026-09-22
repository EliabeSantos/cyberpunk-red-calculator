"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems: Array<{ href: string; label: string; icon: string; disabled?: boolean }> = [
  { href: "/gm", label: "Inimigos", icon: "👥" },
  { href: "/gm/create", label: "Criar Inimigo", icon: "➕" },
  { href: "/gm/dice", label: "Rolagem de Dados", icon: "🎲" },
  { href: "/gm/encounters", label: "Combate", icon: "⚔️" },
];

export default function GMNav() {
  const pathname = usePathname();

  return (
    <nav className="gm-nav" role="navigation" aria-label="Navegação da Área GM">
      <div className="gm-nav-brand">
        <div className="gm-nav-brand-icon">GM</div>
        <div className="gm-nav-brand-text">
          <span className="gm-nav-title">Área GM</span>
          <span className="gm-nav-subtitle">Cyberpunk Red</span>
        </div>
      </div>

      <div className="gm-nav-section">
        <p className="gm-nav-section-label">Principal</p>
        <ul className="gm-nav-list">
          {navItems.map((item) => (
            <li key={item.href}>
              {item.disabled ? (
                <span className="gm-nav-item gm-nav-item-disabled" title="Em desenvolvimento">
                  <span className="gm-nav-item-icon">{item.icon}</span>
                  <span className="gm-nav-item-label">{item.label}</span>
                  <span className="gm-nav-item-badge">Em breve</span>
                </span>
              ) : (
                <Link
                  href={item.href}
                  className={`gm-nav-item ${pathname === item.href || pathname.startsWith(item.href + "/") ? "gm-nav-item-active" : ""}`}
                  aria-current={pathname === item.href || pathname.startsWith(item.href + "/") ? "page" : undefined}
                >
                  <span className="gm-nav-item-icon">{item.icon}</span>
                  <span className="gm-nav-item-label">{item.label}</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="gm-nav-footer">
        <Link href="/" className="gm-nav-back">
          <span className="gm-nav-back-icon">←</span>
          <span>Voltar para Fichas</span>
        </Link>
      </div>
    </nav>
  );
}
