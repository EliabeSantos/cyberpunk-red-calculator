"use client";

import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import MesaEntry from "@/components/mesa/MesaEntry";
import { ArrowLeftIcon, ClockIcon, PlusIcon, SwordsIcon, TargetIcon } from "@/components/icons";

const navItems: Array<{
  href: string;
  label: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  disabled?: boolean;
}> = [
  { href: "/gm", label: "Inimigos", description: "Catálogo e fichas", icon: TargetIcon },
  { href: "/gm/create", label: "Criar inimigo", description: "Montar uma ameaça", icon: PlusIcon },
  { href: "/gm/encounters", label: "Combate", description: "Rodar um encontro", icon: SwordsIcon },
  { href: "/gm/history", label: "Histórico", description: "Rever partidas", icon: ClockIcon },
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
      <header className="gm-nav-head">
        <div className="gm-nav-brand">
          <div className="gm-nav-brand-icon" aria-hidden="true"><span>GM</span><i /></div>
          <div className="gm-nav-brand-text">
            <span className="gm-nav-kicker">REDLINE // OPERADOR</span>
            <span className="gm-nav-title">Central do GM</span>
          </div>
        </div>
        <span className="gm-nav-build">v.01 / ONLINE</span>
      </header>

      <section className="gm-nav-console" aria-label="Status da central">
        <span className="gm-nav-console-label"><i /> Central ativa</span>
        <strong>Controle de campanha</strong>
        <small>Prepare ameaças, encontros e o próximo turno.</small>
      </section>

      <div className="gm-nav-section">
        <span className="gm-nav-section-label">Operação</span>
        <ul className="gm-nav-list">
          {navItems.map(({ href, label, description, icon: Icon, disabled }, index) => {
            const active = !disabled && activeHref === href;
            return (
              <li key={href}>
                {disabled ? (
                  <span className="gm-nav-item gm-nav-item-disabled" title="Em desenvolvimento">
                    <span className="gm-nav-item-index">0{index + 1}</span>
                    <span className="gm-nav-item-icon">
                      <Icon />
                    </span>
                    <span className="gm-nav-item-copy"><span className="gm-nav-item-label">{label}</span><small>{description}</small></span>
                    <span className="gm-nav-item-badge">Em breve</span>
                  </span>
                ) : (
                  <Link
                    href={href}
                    className={`gm-nav-item${active ? " gm-nav-item-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="gm-nav-item-index">0{index + 1}</span>
                    <span className="gm-nav-item-icon">
                      <Icon />
                    </span>
                    <span className="gm-nav-item-copy"><span className="gm-nav-item-label">{label}</span><small>{description}</small></span>
                    <span className="gm-nav-item-arrow" aria-hidden="true">↗</span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="gm-nav-footer">
        <span className="gm-nav-section-label">Acesso rápido</span>
        <Link href="/" className="gm-nav-back">
          <span className="gm-nav-item-icon"><ArrowLeftIcon /></span>
          <span><strong>Voltar para fichas</strong><small>Área do jogador</small></span>
        </Link>
        <div className="gm-nav-mesa"><MesaEntry /></div>
      </div>
    </nav>
  );
}
