"use client";

/**
 * F1.12.5 — Skill Check do Player na Mesa.
 *
 * Reutiliza o mesmo fluxo das rolagens da ficha:
 *   1. `rollSkillCheck()` calcula o resultado localmente (RNG do navegador);
 *   2. `sendMesaRoll()` publica o resumo na Mesa via endpoint server-authoritative;
 *   3. O servidor valida o contexto, debita Action se aplicável e registra o evento.
 *
 * A UI apenas envia INTENÇÃO — custo, debito e resultado publicado são
 * decididos pelo servidor (registerRoll em store.ts).
 */

import { useState } from "react";

import { sendMesaRoll } from "@/lib/mesa/client";
import { rollSkillCheck, type SkillCheckResult } from "@/lib/skills";
import { loadCharacters } from "@/lib/storage";
import type { MesaState, MesaCombatant } from "@/lib/mesa/types";
import type { RunAction } from "./types";

type Context = "free" | "action" | "reaction";

interface Props {
  state: MesaState;
  me: MesaCombatant | null;
  busy: boolean;
  run: RunAction;
  onChanged: () => Promise<void>;
  characterId: string | null;
}

export default function PlayerSkillCheckPanel({ state, me, busy, run, characterId }: Props) {
  const [skillId, setSkillId] = useState("");
  const [context, setContext] = useState<Context>("free");
  const [result, setResult] = useState<SkillCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const combat = state.combat;
  const combatActive = combat?.status === "active" && combat.initiativeStarted;
  const activeId = combat?.activeCombatantId ?? null;
  const myTurn = Boolean(activeId && me && activeId === me.id);

  const skills = characterId
    ? (() => {
        const c = loadCharacters().find((entry) => entry.id === characterId);
        return Object.entries(c?.skills ?? {}).map(([id, skill]) => ({ id, ...skill }));
      })()
    : [];

  // Contexto "action" só quando há Actions sobrando e é nosso turno.
  const canAction = Boolean(me && myTurn && me.actionsRemaining > 0 && !me.isDead);
  // Reaction: fora do turno do GM/Action Economy (sem custo, sempre permitido).
  const canReaction = Boolean(combatActive);

  async function handleRoll() {
    if (!skillId || !characterId) return;
    const character = loadCharacters().find((c) => c.id === characterId);
    if (!character) {
      setError("Personagem não encontrado no navegador.");
      return;
    }
    setError(null);
    setResult(null);

    const resolution = rollSkillCheck(character, skillId, { actionContext: context });
    if ("error" in resolution) {
      setError(resolution.error);
      return;
    }

    const { result: checkResult } = resolution;

    // Publica na Mesa — o servidor decide se conta como Action.
    const roll = {
      type: "skill_check" as const,
      label: checkResult.skillName,
      expression: `1d10${checkResult.critical ? " (crítico!)" : checkResult.fumble ? " (falha crítica!)" : ""}`,
      total: checkResult.total,
      rolls: checkResult.diceRolls.map((r) => r.value),
      skillCheckContext: context,
    };

    await run(
      async () => {
        await sendMesaRoll(state.session.id, roll, characterId);
        setResult(checkResult);
      },
      { onError: (message) => setError(message) },
    );
  }

  return (
    <section className="player-mesa-panel player-mesa-skillcheck">
      <div className="player-mesa-section-heading">
        <span className="mesa-eyebrow">PERÍCIA</span>
        <strong>Skill Check</strong>
      </div>

      {!combatActive && <p className="mesa-hint">Aguardando o combate iniciar para publicar rolagens.</p>}

      <div className="player-mesa-skillcheck-form">
        <label>
          Perícia
          <select
            value={skillId}
            disabled={busy || skills.length === 0}
            onChange={(event) => { setSkillId(event.target.value); setResult(null); setError(null); }}
          >
            <option value="">— selecione —</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.level})
              </option>
            ))}
          </select>
        </label>

        <label>
          Contexto
          <select
            value={context}
            disabled={busy}
            onChange={(event) => setContext(event.target.value as Context)}
          >
            <option value="free">Gratuito (0 Action)</option>
            <option value="action" disabled={!canAction}>
              Action {!canAction ? "(sem Actions)" : ""}
            </option>
            <option value="reaction" disabled={!canReaction}>
              Reaction {!canReaction ? "(sem combate ativo)" : ""}
            </option>
          </select>
        </label>

        <button
          type="button"
          className="mesa-primary player-mesa-skillcheck-button"
          onClick={() => void handleRoll()}
          disabled={busy || !skillId || !characterId}
          title={!characterId ? "Vincule uma ficha para rolar perícia." : undefined}
        >
          {busy ? "Rolando..." : "[ PERÍCIA ]"}
        </button>
      </div>

      {error && <p className="player-mesa-error">{error}</p>}

      {result && (
        <div className="player-mesa-skillcheck-result">
          <strong>
            {result.skillName} {result.total}
            {result.critical && " 🔥 CRÍTICO"}
            {result.fumble && " 💀 FALHA CRÍTICA"}
          </strong>
          <span>
            STAT {result.statId} {result.statValue}+Skill {result.skillLevel}+d10 {result.diceRoll}
            {result.totalModifier ? `+mod ${result.totalModifier}` : ""} = {result.total}
          </span>
          <small>{context === "free" ? "gratuito" : context === "action" ? "custa 1 Action" : "reaction"}</small>
        </div>
      )}

      <p className="mesa-hint">
        Resultado publicado no Registro da Mesa. O servidor decide o custo em Actions.
      </p>
    </section>
  );
}
