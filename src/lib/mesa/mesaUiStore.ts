/**
 * Estado de UI da Mesa: qual mesa está ABERTA na tela principal.
 *
 * Motivo de existir: a sala precisa ser aberta a partir de lugares distintos
 * (botão do nav da ficha, link de convite em outra rota) sem encadear props
 * por todo o árvore. É o mesmo padrão de `membershipStore`: snapshot estável +
 * `useSyncExternalStore`.
 *
 * É estado de tela, não de jogo: fica **em memória** (não vai para o
 * localStorage). Recarregar a página fecha a sala — a reabre pelo nav
 * (📜 Suas mesas) ou pelo link de convite /mesa/CODE.
 */

export interface MesaUiSnapshot {
  open: boolean;
  joinCode: string | null;
}

const EMPTY: MesaUiSnapshot = { open: false, joinCode: null };

let snapshot: MesaUiSnapshot = EMPTY;
const listeners = new Set<() => void>();

export function getMesaUiSnapshot(): MesaUiSnapshot {
  return snapshot;
}

/** Durante SSR e na primeira leitura da hidratação: sempre fechado. */
export function getServerMesaUiSnapshot(): MesaUiSnapshot {
  return EMPTY;
}

export function subscribeToMesaUi(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(next: MesaUiSnapshot): void {
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Abre a sala da mesa indicada na tela principal. */
export function openMesa(joinCode: string): void {
  commit({ open: true, joinCode: joinCode.toUpperCase() });
}

/** Fecha a sala (a sessão no servidor não é afetada). */
export function closeMesa(): void {
  commit(EMPTY);
}
