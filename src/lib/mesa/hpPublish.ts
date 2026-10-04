/**
 * Espelho de VIDA (HP) da ORIGEM PARA A MESA (NAVEGADOR).
 *
 * A ficha do jogador é a dona da vida dele e o encontro do Mestre é o dono da
 * vida dos inimigos: quando o valor muda lá, ele é enviado para a mesa e
 * aparece para todo mundo no painel de combate (`mesa_combatants.hp_current`).
 *
 * Um sentindo só — nada volta da mesa para a ficha (decisão de 27/09/2026).
 * Assim como o espelho de rolagens, é fire-and-forget de verdade: sem mesa
 * ativa não manda nada e falha de rede/migração pendente nunca quebra a tela.
 */
import { getActiveMembership } from "@/lib/mesa/membershipStore";
import { sendMesaEngineDamage, sendMesaHp, type MesaEngineDamageUpdate, type MesaHpUpdate } from "@/lib/mesa/client";
import type { Character } from "@/types/character";

function send(update: MesaHpUpdate): void {
  const membership = getActiveMembership();
  if (!membership) return; // modo local: nada a enviar
  void sendMesaHp(membership.sessionId, update).catch(() => {
    // Mesa encerrada, sessão fechada, rede fora ou migração pendente:
    // a origem (ficha/encontro) nunca quebra.
  });
}

function hpView(character: Character | null | undefined): { hp: number; hpMax: number; isDead: boolean } | null {
  const hp = character?.combat?.hp;
  if (!hp || !Number.isFinite(hp.current) || !Number.isFinite(hp.max)) return null;
  return { hp: Math.floor(hp.current), hpMax: Math.floor(hp.max), isDead: Boolean(character?.combat?.isDead) };
}

/**
 * Vida da FICHA que mudou → combatente do próprio participante na mesa.
 *
 * Chamar no mesmo ponto do espelho de rolagens (`CharacterToolkit.onUpdate`),
 * passando o estado ANTES e o DEPOIS: sem mudança de HP/HP máximo/morte não
 * sai requisição nenhuma. `before === null` (personagem recém-criado) empurra
 * o valor atual — o servidor vira no-op se não houver combatente vinculado.
 */
export function publishMesaHp(
  before: Character | null | undefined,
  after: Character | null | undefined,
): void {
  const next = hpView(after);
  if (!next) return;

  const previous = hpView(before);
  if (
    previous &&
    previous.hp === next.hp &&
    previous.hpMax === next.hpMax &&
    previous.isDead === next.isDead
  ) {
    return; // nada de vida mudou neste update
  }

  send({ hp: next.hp, hpMax: next.hpMax, isDead: next.isDead });
}

/**
 * Vida do INIMIGO mudou no encontro do Mestre → linha correspondente da mesa.
 *
 * `key` é o `id` estável do participante do encontro (é o que vira
 * `source_key` no servidor). Sem chave (encontro antigo) não há como achar a
 * linha, então nada é enviado — o Mestre continua ajustando no painel.
 *
 * `hpBefore` (F1.7.1) é o HP da origem ANTES da mudança: levado ao servidor
 * como precondição, ele impede um push atrasado de sobrescrever um resultado
 * mais novo (resolução do Combat Engine ou ajuste manual do painel).
 */
export function publishMesaEnemyHp(
  key: string | null | undefined,
  hp: number,
  hpBefore?: number,
): void {
  if (!key || !Number.isFinite(hp)) return;
  const before = typeof hpBefore === "number" && Number.isFinite(hpBefore) ? Math.floor(hpBefore) : null;
  send({ key, hp: Math.floor(hp), ...(before !== null ? { hpBefore: before } : {}) });
}

/**
 * Mochila do INIMIGO mudou na tela de Encontros (tiro, recarregamento ou cura
 * usado) → mesma linha da mesa do espelho de vida.
 *
 * Mesmos portões de `publishMesaEnemyHp`: sem chave não há como achar a linha,
 * e falha de rede/migração pendente nunca quebra a origem. O HP vai junto só
 * porque é o mesmo caminho de escrita do servidor — ele é reenviado como está
 * (com `hpBefore` igual ao atual: a mochila não mexe na vida, então a guarda
 * só protege um valor que não deveria mudar).
 */
export function publishMesaEnemySupplies(
  key: string | null | undefined,
  hp: number,
  supplies: MesaHpUpdate["supplies"],
  hpBefore?: number,
): void {
  if (!key || !supplies || !Number.isFinite(hp)) return;
  const before = typeof hpBefore === "number" && Number.isFinite(hpBefore) ? Math.floor(hpBefore) : null;
  send({ key, hp: Math.floor(hp), supplies, ...(before !== null ? { hpBefore: before } : {}) });
}

/**
 * F1.7.1 — dano de INIMIGO resolvido pelo Combat Engine no servidor
 * (`POST /combat/damage`, caminho B). Mesmo portão do espelho (sem mesa ativa
 * não manda nada), mas AO CONTRÁRIO do espelho REJEITA em recusa: o promise
 * rejeita (`409 stale_hp`/`hp_conflict`, rede, migração pendente) para o
 * chamador decidir o fallback. `200 {updated:false}` resolve normal — sem
 * combate ativo o espelho antigo também não faria nada.
 */
export async function publishMesaEngineDamage(update: MesaEngineDamageUpdate): Promise<void> {
  const membership = getActiveMembership();
  if (!membership) return; // modo local: nada a enviar
  await sendMesaEngineDamage(membership.sessionId, update);
}
