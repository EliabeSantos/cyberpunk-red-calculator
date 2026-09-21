"use client";

import { useEffect, useState } from "react";
import { hasGMAccess, enableGMAccessForDevelopment, setGMSession } from "@/lib/gmStorage";

interface GMAccessGateProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function GMAccessGate({ children, fallback }: GMAccessGateProps) {
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [showDevLogin, setShowDevLogin] = useState(false);
  const [devPassword, setDevPassword] = useState("");

  useEffect(() => {
    // Check if user has GM access
    const access = hasGMAccess();
    setAuthorized(access);
    setChecking(false);
  }, []);

  const handleDevLogin = (event: React.FormEvent) => {
    event.preventDefault();
    // Simple dev password - in production this would be replaced with real auth
    if (devPassword === "gm2024" || devPassword === "cyberpunk") {
      enableGMAccessForDevelopment();
      setAuthorized(true);
      setShowDevLogin(false);
    } else {
      alert("Senha incorreta. Dica: gm2024 ou cyberpunk");
    }
  };

  const handleQuickEnable = () => {
    enableGMAccessForDevelopment();
    setAuthorized(true);
  };

  if (checking) {
    return (
      <div className="gm-access-loading" role="status" aria-label="Verificando acesso GM">
        <div className="gm-access-spinner" aria-hidden="true"></div>
        <p>Verificando acesso à Área GM...</p>
      </div>
    );
  }

  if (!authorized) {
    return (
      <section className="gm-access-denied" role="alert">
        <div className="gm-access-card">
          <div className="gm-access-icon" aria-hidden="true">🔒</div>
          <h1>Área Restrita do GM</h1>
          <p className="gm-access-description">
            Esta área é exclusiva para Mestres de Jogo. O acesso requer autenticação.
          </p>
          
          {!showDevLogin ? (
            <div className="gm-access-actions">
              <button
                type="button"
                className="gm-access-button gm-access-button-primary"
                onClick={() => setShowDevLogin(true)}
              >
                Acesso de Desenvolvimento
              </button>
              <p className="gm-access-note">
                Em produção, isto será substituído por autenticação real (NextAuth, Clerk, etc.)
              </p>
            </div>
          ) : (
            <form onSubmit={handleDevLogin} className="gm-access-form">
              <label htmlFor="dev-password" className="gm-access-label">
                Senha de desenvolvimento
              </label>
              <input
                id="dev-password"
                type="password"
                value={devPassword}
                onChange={(e) => setDevPassword(e.target.value)}
                placeholder="Digite a senha"
                className="gm-access-input"
                autoFocus
              />
              <div className="gm-access-form-actions">
                <button type="submit" className="gm-access-button gm-access-button-primary">
                  Entrar
                </button>
                <button
                  type="button"
                  className="gm-access-button gm-access-button-secondary"
                  onClick={() => setShowDevLogin(false)}
                >
                  Cancelar
                </button>
              </div>
              <p className="gm-access-hint">Dica: <code>gm2024</code> ou <code>cyberpunk</code></p>
            </form>
          )}

          <details className="gm-access-dev-info">
            <summary>Informações para desenvolvedores</summary>
            <div className="gm-access-dev-content">
              <p>Esta é uma proteção temporária baseada em <code>localStorage</code>.</p>
              <p>Para implementar autenticação real, substitua <code>hasGMAccess()</code> em <code>src/lib/gmStorage.ts</code> por verificação de sessão do seu provedor de auth (NextAuth, Clerk, Auth.js, etc.).</p>
              <p>A estrutura está preparada para receber <code>userId</code>, <code>role</code>, <code>permissions</code>, etc.</p>
            </div>
          </details>
        </div>
      </section>
    );
  }

  return <>{children}</>;
}