"use client";

import { ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import GMNav from "@/components/gm/GMNav";
import MesaRoomDock from "@/components/mesa/MesaRoomDock";
import { subscribeToMembership, getMembershipSnapshot, getServerMembershipSnapshot } from "@/lib/mesa/membershipStore";

interface GMShellProps {
  children: ReactNode;
}

export default function GMShell({ children }: GMShellProps) {
  const [navOpen, setNavOpen] = useState(false);

  // Gaveta do menu GM (mobile): ESC fecha e o scroll da página trava enquanto aberta.
  useEffect(() => {
    if (!navOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [navOpen]);

  return (
    <div className={`gm-shell${navOpen ? " gm-nav-open" : ""}`}>
      <div className="gm-mobile-topbar">
        <div className="gm-mobile-brand">
          <div className="gm-nav-brand-icon">GM</div>
          <span className="gm-nav-title">Área GM</span>
        </div>
        <button
          type="button"
          className="gm-nav-hamburger"
          aria-label={navOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
      <aside
        className="gm-sidebar"
        // No mobile a sidebar vira gaveta: tocar em qualquer link fecha o menu.
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setNavOpen(false);
        }}
      >
        <GMNav />
      </aside>
      <div
        className={`gm-nav-backdrop${navOpen ? " is-open" : ""}`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />
      <main className="gm-main" role="main">
        {children}
      </main>
      <MesaRoomDock />
    </div>
  );
}