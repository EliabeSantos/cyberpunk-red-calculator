"use client";

import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import MesaEntry from "@/components/mesa/MesaEntry";
import { ArrowLeftIcon, PlusIcon, SwordsIcon, TargetIcon } from "@/components/icons";

const navItems: Array<{
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  disabled?: boolean;
}> = [
  { href: "/gm", label: "Inimigos", icon: TargetIcon },
  { href: "/gm/create", label: "Criar Inimigo", icon: PlusIcon },
  { href: "/gm/encounters", label: "Combate", icon: SwordsIcon },
];

export default function GMNav() {
  const pathname = usePathname();

  // "/gm" é prefixo de "/gm/create" e "/gm/encounters": entre os hrefs que
  // casam com a rota atual, o mais longo é o mais específico — sem isso dois
  // itens (ou os três) ficariam ativos ao mesmo tempo.
  const activeHref = navItems
    .map((item) => item.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

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
        <ul className="gm-nav-list">
          {navItems.map(({ href, label, icon: Icon, disabled }) => {
            const active = !disabled && activeHref === href;
            return (
              <li key={href}>
                {disabled ? (
                  <span className="gm-nav-item gm-nav-item-disabled" title="Em desenvolvimento">
                    <span className="gm-nav-item-icon">
                      <Icon />
                    </span>
                    <span className="gm-nav-item-label">{label}</span>
                    <span className="gm-nav-item-badge">Em breve</span>
                  </span>
                ) : (
                  <Link
                    href={href}
                    className={`gm-nav-item${active ? " gm-nav-item-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="gm-nav-item-icon">
                      <Icon />
                    </span>
                    <span className="gm-nav-item-label">{label}</span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="gm-nav-footer">
        <Link href="/" className="gm-nav-back">
          <span className="gm-nav-item-icon">
            <ArrowLeftIcon />
          </span>
          <span>Voltar para Fichas</span>
        </Link>
        <MesaEntry />
      </div>
    </nav>
  );
}
