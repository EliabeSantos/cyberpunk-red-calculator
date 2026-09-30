/**
 * Implantes (cyberware) dos inimigos no encontro.
 *
 * Mesmo espírito das características de personalidade (`getRandomTraits(2)`):
 * quando o encontro é criado, cada inimigo **já vem com implantes**, e quanto
 * maior o nível dele, mais implantes ele tem (nível 1 → 2 … nível 4 → 5).
 *
 * Efeito mecânico desde 30/09/2026: os implantes **somam nos dados que o
 * inimigo rola** (ataque, Evasão, Iniciativa, dano desarmado) e no SP do corpo,
 * com a mesma regra da ficha do jogador — ver `src/lib/enemyCyberware.ts`.
 * Aqui continua sendo só a LISTA de nomes; quem aplica é o motor de rolagem.
 *
 * A lista começa pelos cyberware que já vêm no JSON do inimigo (quando o
 * catálogo trouxe) e só então é completada até a cota com sorteio do catálogo
 * de cyberware do jogador (`items.json`) — nomes canônicos, sem repetição e
 * nunca removendo o que o inimigo já tinha.
 */
import { catalogItems } from "@/data/items";

/**
 * Cota de implantes por nível do inimigo (1..4, vindo do `threatLevel`).
 * Nível fora da faixa é aparado para dentro — o inimigo nunca fica sem
 * implante e nunca passa do teto de 5.
 */
export function implantCountForLevel(level: number): number {
  const safe = Number.isFinite(level) ? Math.floor(level) : 1;
  const clamped = Math.max(1, Math.min(4, safe));
  return clamped + 1; // 1 → 2, 2 → 3, 3 → 4, 4 → 5
}

/** Nomes de cyberware do catálogo, prontos para sortear. */
export function implantPool(): string[] {
  return catalogItems
    .filter((item) => item.category === "cyberware")
    .map((item) => item.name.trim())
    .filter((name) => name.length > 0);
}

/**
 * Implantes de UM inimigo: preserva os que vieram no JSON dele e completa até
 * a cota do nível com sorteio (sem repetir). Base acima da cota não é cortada
 * — o que o catálogo definiu é palavra final.
 */
export function getEnemyImplants(base: string[] | null | undefined, level: number): string[] {
  const quota = implantCountForLevel(level);
  const implants: string[] = [];

  const push = (name: unknown): void => {
    if (typeof name !== "string") return;
    const trimmed = name.trim();
    if (trimmed.length === 0 || implants.includes(trimmed)) return;
    implants.push(trimmed);
  };

  for (const name of base ?? []) push(name);
  if (implants.length >= quota) return implants;

  const shuffled = implantPool().sort(() => Math.random() - 0.5);
  for (const name of shuffled) {
    if (implants.length >= quota) break;
    push(name);
  }

  return implants;
}
