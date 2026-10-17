"use client";

/**
 * Hook que liga o controlador de estado visual (módulo puro) ao snapshot da
 * Mesa. SOMENTE camada de apresentação: lê `MesaState` (fonte autoritativa do
 * servidor) e decide qual imagem de corpo inteiro cada combatente exibe —
 * nunca escreve nada no estado da Mesa nem em cálculos de combate.
 *
 * Sinais consumidos:
 * - snapshot (`combatants`): derrota registrada (`isDead`), dano recebido
 *   (queda de `hpCurrent`) e recarga (`ammoByWeapon` subiu) — funcionam em
 *   QUALQUER cliente, mesmo o que não viu a ação acontecer;
 * - resultado confirmado de ataque (`reportAttack`, chamado a partir da
 *   resposta autenticada de `/combat/attack` já confirmada): SHOOT,
 *   MELEE_ATTACK, DODGE (defesa `evasion` sem acerto) e HIT no alvo.
 *
 * Manifesto: consultado sob demanda via cache de sessão (TTL curto, abaixo da
 * validade das URLs assinadas); personagens legados sem personalização e
 * inimigos (`characterId` nulo) usam o boneco genérico do `CombatantFigure`.
 * Falha de manifesto ou de imagem nunca interrompe o combate.
 */

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import {
  attackVisualEffects,
  CombatVisualStateController,
  resolveCombatStateImage,
  type ConfirmedAttackVisualOutcome,
  type ResolvedCombatStateImage,
} from "@/lib/characterVisual/combatVisualState";
import { DEFAULT_COMBAT_VISUAL_STATE } from "@/lib/characterVisual/visualStates";
import type { CharacterVisualIdentity } from "@/lib/characterVisual/visualIdentity";
import {
  ensureVisualManifests,
  isVisualUrlFailed,
  invalidateVisualManifest,
} from "@/lib/characterVisual/visualManifestCache";
import type { MesaState } from "@/lib/mesa/types";

/** Resultado de ataque já confirmado pelo servidor (chega com a resposta). */
export type { ConfirmedAttackVisualOutcome };

export interface CombatVisualsApi {
  /**
   * Imagem do corpo inteiro para o estado ativo do combatente; `null` quando
   * não há personalização (o renderizador usa o boneco genérico).
   */
  imageFor(combatantId: string): ResolvedCombatStateImage | null;
  /** Reporta um ataque CONFIRMADO (somente após a resposta do servidor). */
  reportAttack(outcome: ConfirmedAttackVisualOutcome): void;
}

function sameManifests(
  current: Record<string, CharacterVisualIdentity>,
  next: Record<string, CharacterVisualIdentity>,
): boolean {
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  if (currentKeys.length !== nextKeys.length) return false;
  return nextKeys.every((key) => current[key]?.updatedAt === next[key]?.updatedAt);
}

export function useCombatVisuals(state: MesaState): CombatVisualsApi {
  // Controlador estável criado UMA vez (estado lazy do React — sem acesso a
  // refs durante o render, conforme as regras react-hooks/refs).
  const [controller] = useState(() => new CombatVisualStateController());

  const [manifests, setManifests] = useState<Record<string, CharacterVisualIdentity>>({});
  const [version, setVersion] = useReducer((current: number) => current + 1, 0);

  // Consome cada snapshot autenticado UMA vez (dedupe/prioridade ficam no
  // controlador puro — re-renderizações repetidas do mesmo estado não geram
  // novos efeitos visuais).
  useEffect(() => {
    controller.recordSnapshot(
      state.combat?.id ?? null,
      state.combatants.map((combatant) => ({
        id: combatant.id,
        isDead: combatant.isDead,
        hpCurrent: combatant.hpCurrent,
        ammoByWeapon: combatant.ammoByWeapon ?? null,
      })),
    );
    setVersion();
  }, [controller, state]);

  // Manifestos sob demanda (cache de sessão): UMA consulta por personagem por
  // TTL, não uma por renderização.
  useEffect(() => {
    let cancelled = false;
    const ids = state.combatants
      .map((combatant) => combatant.characterId)
      .filter((characterId): characterId is string => typeof characterId === "string" && characterId.length > 0);
    if (ids.length === 0) return;
    void ensureVisualManifests(ids, {
      sessionId: state.session.id,
      fallbackName: (characterId) =>
        state.combatants.find((combatant) => combatant.characterId === characterId)?.name ?? "",
    }).then((resolved) => {
      if (cancelled) return;
      setManifests((current) => (sameManifests(current, resolved) ? current : resolved));
    });
    return () => {
      cancelled = true;
    };
  }, [state]);

  // UM timeout para o próximo vencimento de estado temporário (sem polling).
  useEffect(() => {
    const expiry = controller.nextExpiryAt();
    if (expiry === null) return;
    const timer = window.setTimeout(() => setVersion(), Math.max(0, expiry - Date.now()) + 40);
    return () => window.clearTimeout(timer);
  }, [controller, state, manifests, version]);

  const reportAttack = useCallback((outcome: ConfirmedAttackVisualOutcome) => {
    // Só re-renderiza quando algo de fato mudou (evita churn em cliques
    // repetidos ou retries idempotentes); o mapeamento efeito-real → estado é
    // puro (`attackVisualEffects`), coberto pelos testes sem React.
    let changed = false;
    for (const { combatantId, effect } of attackVisualEffects(outcome)) {
      changed = controller.report({ combatantId, effect }) || changed;
    }
    if (changed) setVersion();
  }, [controller]);

  const imageFor = useCallback((combatantId: string): ResolvedCombatStateImage | null => {
    const combatant = state.combatants.find((entry) => entry.id === combatantId);
    if (!combatant) return null;
    const visualState = controller.activeStateFor(combatantId) ?? DEFAULT_COMBAT_VISUAL_STATE;
    const identity = combatant.characterId ? manifests[combatant.characterId] : undefined;
    return resolveCombatStateImage(identity, visualState, isVisualUrlFailed);
  }, [controller, manifests, state]);

  return useMemo(() => ({ imageFor, reportAttack }), [imageFor, reportAttack]);
}

/** Invalida o manifesto do personagem após salvar/remover imagens (Etapa 1). */
export { invalidateVisualManifest };
