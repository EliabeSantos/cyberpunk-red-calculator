"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems: Array<{ href: string; label: string; icon: string; disabled?: boolean }> = [
  { href: "/gm", label: "Inimigos", icon: "👥" },
  { href: "/gm/create", label: "Criar Inimigo", icon: "➕" },
  { href: "/gm/dice", label: "Rolagem de Dados", icon: "🎲" },
  { href: "/gm/encounters", label: "Combate/Encontros", icon: "⚔️" },
];

export default function GMNav() {
  const pathname = usePathname();

  return (
    <nav className="gm-nav" role="navigation" aria-label="Navegação da Área GM">
      <div className="gm-nav-brand">
        <span className="gm-nav-icon">🎮</span>
        <span className="gm-nav-title">ÁREA GM</span>
      </div>
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
      <div className="gm-nav-divider" />
      <div className="gm-nav-footer">
        <Link href="/" className="gm-nav-back">
          <span>←</span> Voltar para Fichas
        </Link>
      </div>
    </nav>
  );
}