"use client";

import { ReactNode } from "react";
import GMNav from "@/components/gm/GMNav";

interface GMShellProps {
  children: ReactNode;
}

export default function GMShell({ children }: GMShellProps) {
  return (
    <div className="gm-shell">
      <aside className="gm-sidebar">
        <GMNav />
      </aside>
      <main className="gm-main" role="main">
        {children}
      </main>
    </div>
  );
}