"use client";

/**
 * Tela de personalização visual do personagem.
 *
 * Vinculada à ficha persistente ativa (mesmo fluxo de leitura do
 * `CharacterToolkit`): retrato de perfil independente + imagens de corpo
 * inteiro por estado de combate, com pré-visualização, estado obrigatório
 * IDLE, salvamento com feedback e descarte de alterações não salvas.
 *
 * As alterações ficam em rascunho local até "Salvar"; "Descartar" apenas
 * zera o rascunho e recarrega o manifesto do servidor — nada é persistido
 * implicitamente.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getActiveCharacterId, loadCharacters } from "@/lib/storage";
import { loadRemoteCharacters } from "@/lib/toolkitClient";
import { readImageFileAsDataUrl } from "@/lib/characterVisual/imageFile";
import {
  CharacterVisualApiError,
  fetchCharacterVisual,
  removeCharacterVisualImage,
  saveCharacterVisualDisplayName,
  saveCharacterVisualImage,
  type ClientVisualSlot,
} from "@/lib/characterVisual/visualClient";
import { COMBAT_VISUAL_STATE_CATALOG, isRequiredVisualState, type CombatVisualState } from "@/lib/characterVisual/visualStates";
import { invalidateVisualManifest } from "@/lib/characterVisual/visualManifestCache";
import type { CharacterVisualIdentity } from "@/lib/characterVisual/visualIdentity";
import type { Character } from "@/types/character";

type SlotKey = "portrait" | CombatVisualState;

interface StagedImage {
  dataUrl: string;
  width: number;
  height: number;
}

type StagedChange = { type: "image"; image: StagedImage } | { type: "removed" };

function slotOf(key: SlotKey): ClientVisualSlot {
  return key === "portrait" ? { kind: "portrait" } : { kind: "combat_state", state: key };
}

function errorMessage(error: unknown): string {
  if (error instanceof CharacterVisualApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Ocorreu um erro inesperado.";
}

export default function CharacterVisualCustomizer() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [identity, setIdentity] = useState<CharacterVisualIdentity | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, StagedChange>>({});
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSlotRef = useRef<SlotKey | null>(null);

  // ==== (A) carregamento das fichas + manifesto visual ====

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let loaded: Character[] = [];
        try {
          loaded = await loadRemoteCharacters();
        } catch {
          loaded = loadCharacters();
        }
        if (cancelled) return;
        setCharacters(loaded);
        const activeId = getActiveCharacterId();
        const selected = loaded.find((character) => character.id === activeId) ?? loaded[0] ?? null;
        setCharacterId(selected?.id ?? null);
      } catch (error) {
        if (!cancelled) setLoadError(errorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCharacter = useMemo(
    () => characters.find((character) => character.id === characterId) ?? null,
    [characters, characterId],
  );

  const loadIdentity = useCallback(async (id: string, fallbackName: string) => {
    const loaded = await fetchCharacterVisual(id, { fallbackName });
    setIdentity(loaded);
    return loaded;
  }, []);

  useEffect(() => {
    if (!characterId || !selectedCharacter) return;
    // Troca de personagem: recarrega o manifesto e descarta rascunhos antigos.
    // As respostas são ordenadas por `cancelled` para não sobrescrever a tela
    // com dados de outra ficha.
    void (async () => {
      try {
        const loaded = await fetchCharacterVisual(characterId, {
          fallbackName: selectedCharacter.identity?.name ?? "",
        });
        setIdentity(loaded);
        setDrafts({});
        setDisplayNameDraft(null);
        setActionError(null);
        setNotice(null);
      } catch (error) {
        setLoadError(errorMessage(error));
      }
    })();
  }, [characterId, selectedCharacter]);

  // ==== (B) rascunho: escolher/remover imagem sem tocar no servidor ====

  const stagedCount = Object.keys(drafts).length + (displayNameDraft !== null ? 1 : 0);
  const dirty = stagedCount > 0;

  const openFilePicker = (key: SlotKey) => {
    pendingSlotRef.current = key;
    fileInputRef.current?.click();
  };

  const onFileChosen = async (file: File | undefined) => {
    const key = pendingSlotRef.current;
    pendingSlotRef.current = null;
    if (!file || !key) return;
    try {
      const selected = await readImageFileAsDataUrl(file);
      setActionError(null);
      setNotice(null);
      setDrafts((current) => ({
        ...current,
        [key]: {
          type: "image",
          image: { dataUrl: selected.dataUrl, width: selected.validated.width, height: selected.validated.height },
        },
      }));
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const markRemoved = (key: SlotKey) => {
    if (isRequiredVisualState(key as CombatVisualState)) return; // IDLE é obrigatória
    setActionError(null);
    setNotice(null);
    setDrafts((current) => ({ ...current, [key]: { type: "removed" } }));
  };

  const revertDrafts = () => {
    setDrafts({});
    setDisplayNameDraft(null);
    setActionError(null);
    setNotice(null);
    if (characterId && selectedCharacter) {
      void loadIdentity(characterId, selectedCharacter.identity?.name ?? "").catch((error) => {
        setLoadError(errorMessage(error));
      });
    }
  };

  // ==== (C) salvar: nome primeiro, depois imagens na ordem escolhida ====

  const save = async () => {
    if (!characterId || !identity || saving) return;
    setSaving(true);
    setActionError(null);
    setNotice(null);
    try {
      let next = identity;
      if (displayNameDraft !== null && displayNameDraft !== identity.displayName) {
        next = await saveCharacterVisualDisplayName(characterId, displayNameDraft);
      }
      for (const [key, change] of Object.entries(drafts)) {
        const slot = slotOf(key as SlotKey);
        next = change.type === "removed"
          ? await removeCharacterVisualImage(characterId, slot)
          : await saveCharacterVisualImage(characterId, slot, change.image.dataUrl);
      }
      setIdentity(next);
      setDrafts({});
      setDisplayNameDraft(null);
      // Mantém o cache de sessão do combate (Etapa 2) coerente: se a mesa
      // estiver aberta nesta sessão, a próxima consulta busca o manifesto
      // novo (assets removidos não continuam parecendo ativos).
      invalidateVisualManifest(characterId);
      setNotice(next.completion.ready
        ? "Personalização visual salva."
        : "Alterações salvas. Ainda falta a imagem obrigatória de Prontidão (IDLE).");
    } catch (error) {
      // As alterações restantes continuam em rascunho para nova tentativa.
      setActionError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  // ==== (D) pré-visualizações (rascunho tem prioridade sobre o persistido) ====

  const portraitDraft = drafts.portrait;
  const portraitPreview = portraitDraft?.type === "image"
    ? portraitDraft.image.dataUrl
    : portraitDraft?.type === "removed"
      ? null
      : identity?.portraitUrl ?? null;

  const statePreviewOf = (state: CombatVisualState): { url: string | null; pending: boolean } => {
    const draft = drafts[state];
    if (draft?.type === "image") return { url: draft.image.dataUrl, pending: true };
    if (draft?.type === "removed") return { url: null, pending: true };
    const resolved = identity?.states.find((entry) => entry.state === state) ?? null;
    return { url: resolved?.url ?? null, pending: false };
  };

  if (loading) {
    return <main className="loading-screen">Carregando personalização…</main>;
  }
  if (!characterId || !selectedCharacter) {
    return (
      <main className="visual-shell">
        <div role="alert" className="gm-access-denied">
          Crie ou importe uma ficha de personagem antes de personalizar a aparência.
        </div>
      </main>
    );
  }

  return (
    <main className="visual-shell">
      <header className="creator-header">
        <p className="eyebrow">Identidade visual</p>
        <h1>Aparência</h1>
        <p>
          Personalize o retrato e as imagens de corpo inteiro usadas no combate. O retrato é a foto
          de perfil; ele <strong>não</strong> representa o personagem no mapa — para isso use a
          imagem de Prontidão (IDLE).
        </p>
      </header>

      {loadError && <div role="alert" className="gm-access-denied">{loadError}</div>}
      {actionError && <div role="alert" className="gm-access-denied">{actionError}</div>}
      {notice && <div className="visual-notice" role="status">{notice}</div>}

      <section className="creator-card visual-identity-card">
        <div className="section-heading">
          <div>
            <span>01 // Identidade</span>
            <h2>Personagem</h2>
          </div>
        </div>

        <div className="visual-identity-fields">
          {characters.length > 1 && (
            <label className="identity-field">
              <span>Ficha editada</span>
              <select
                className="gm-form-input"
                value={characterId}
                onChange={(event) => setCharacterId(event.target.value)}
              >
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.identity?.name || "Sem nome"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="identity-field">
            <span>Nome de exibição</span>
            <input
              className="gm-form-input"
              type="text"
              maxLength={80}
              placeholder={identity?.fallbackDisplayName ?? "Nome exibido no combate"}
              value={displayNameDraft ?? identity?.displayName ?? ""}
              onChange={(event) => setDisplayNameDraft(event.target.value)}
            />
          </label>
          <div className="identity-field">
            <span>Identificador persistente</span>
            <code className="visual-character-id">{characterId}</code>
          </div>
        </div>
      </section>

      <section className="creator-card visual-portrait-card">
        <div className="section-heading">
          <div>
            <span>02 // Retrato</span>
            <h2>Foto de perfil</h2>
          </div>
        </div>
        <div className="visual-portrait-row">
          <div className="visual-portrait-frame">
            {portraitPreview ? (
              <img src={portraitPreview} alt="Pré-visualização do retrato" />
            ) : (
              <span>SEM FOTO</span>
            )}
          </div>
          <div className="visual-portrait-actions">
            <p className="visual-hint">
              quadrada ou circular, PNG/JPEG/WebP de até 2&nbsp;MB. Independentemente das imagens do mapa.
            </p>
            <button type="button" className="secondary-button" onClick={() => openFilePicker("portrait")}>
              {portraitPreview ? "Substituir retrato" : "Escolher retrato"}
            </button>
            {portraitPreview && (
              <button type="button" className="secondary-button" onClick={() => markRemoved("portrait")}>
                Remover retrato
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="creator-card visual-states-card">
        <div className="section-heading">
          <div>
            <span>03 // Estados de combate</span>
            <h2>Imagens por estado</h2>
          </div>
          <strong>
            {identity?.completion.ready ? "CONFIGURAÇÃO COMPLETA" : "CONFIGURAÇÃO INCOMPLETA"}
          </strong>
        </div>

        {!identity?.completion.ready && (
          <div role="alert" className="visual-idle-warning">
            Configure a imagem obrigatória <strong>Prontidão (IDLE)</strong>: sem ela o combate usa o
            boneco genérico e a configuração visual fica incompleta.
          </div>
        )}

        <div className="visual-state-grid">
          {COMBAT_VISUAL_STATE_CATALOG.map((definition, index) => {
            const key = definition.id;
            const preview = statePreviewOf(key);
            const configured = identity?.configuredStates.includes(key) ?? false;
            const resolved = identity?.states.find((entry) => entry.state === key) ?? null;
            const isFallback = preview.pending
              ? drafts[key]?.type === "image"
              : resolved?.source === "idle-fallback";
            return (
              <article key={key} className="visual-state-card">
                <header>
                  <span className="visual-state-index">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{definition.label}</h3>
                    <p>{definition.hint}</p>
                  </div>
                </header>
                <div className={`visual-state-thumb${preview.url ? "" : " is-empty"}`}>
                  {preview.url
                    ? <img src={preview.url} alt={`Pré-visualização: ${definition.label}`} />
                    : <span>SEM IMAGEM</span>}
                </div>
                <footer>
                  <span className={`visual-state-badge${configured || preview.pending ? " is-on" : ""}`}>
                    {preview.pending
                      ? (drafts[key]?.type === "removed" ? "REMOVER" : "PRÉ-VISUALIZAÇÃO")
                      : configured
                        ? (isFallback ? "USA A IDLE" : "CONFIGURADO")
                        : (definition.required ? "OBRIGATÓRIO" : "AUSENTE")}
                  </span>
                  <div className="visual-state-actions">
                    <button type="button" className="secondary-button" onClick={() => openFilePicker(key)}>
                      {configured || preview.pending ? "Substituir" : "Adicionar"}
                    </button>
                    {(configured || drafts[key]) && !isRequiredVisualState(key) && (
                      <button type="button" className="secondary-button" onClick={() => markRemoved(key)}>
                        Remover
                      </button>
                    )}
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      </section>

      <footer className="creator-footer visual-footer">
        <p>
          {dirty
            ? `${stagedCount} alteração(ões) ainda não salva(s).`
            : "Nenhuma alteração pendente."}
        </p>
        <div className="creator-footer-actions">
          <button type="button" className="secondary-button" onClick={revertDrafts} disabled={saving || !dirty}>
            Descartar
          </button>
          <button type="button" className="save-button" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </footer>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void onFileChosen(file);
        }}
      />
    </main>
  );
}
