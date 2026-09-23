"use client";

import { useCallback, useEffect, useState } from "react";

import type { DiscordConfigView, DiscordDirectoryGuild } from "@/lib/discord/types";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Código da mesa que está sendo configurada. */
  sessionCode: string;
};

type ViewResponse = DiscordConfigView & { ok?: boolean; error?: string };

/**
 * Painel "Discord Integration": Status, Servidor, Canal e Salvar.
 * Lista os servidores onde o único bot está instalado e grava a vinculação
 * mesa → guildId → channelId no servidor.
 */
export default function DiscordIntegrationPanel({ open, onClose, sessionCode }: Props) {
  const [view, setView] = useState<DiscordConfigView | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [guildId, setGuildId] = useState("");
  const [channelId, setChannelId] = useState("");

  // Aplica a resposta da API (chamado apenas em callbacks assíncronos/handlers).
  const applyResponse = useCallback(
    (ok: boolean, body: ViewResponse | null, networkError?: string) => {
      if (networkError || !ok || !body?.ok) {
        setView(null);
        setError(networkError ?? body?.error ?? "Falha ao carregar a configuração do Discord.");
        return;
      }
      setView(body);
      setGuildId(body.current?.guildId ?? "");
      setChannelId(body.current?.channelId ?? "");
      setError("");
    },
    [],
  );

  // Disparo via callbacks de promise: nenhum setState é chamado sincronamente
  // pelo effect (a regra lint proíbe exatamente isso).
  useEffect(() => {
    if (!open || !sessionCode) return;
    void fetch(`/api/discord/config?session=${encodeURIComponent(sessionCode)}`)
      .then(async (response) =>
        applyResponse(
          response.ok,
          (await response.json().catch(() => null)) as ViewResponse | null,
        ),
      )
      .catch(() => applyResponse(false, null, "Falha ao conversar com o servidor."));
  }, [open, sessionCode, applyResponse]);

  if (!open) return null;

  // "Carregando" é derivado: painel aberto, ainda sem resposta e sem erro.
  const loading = Boolean(sessionCode) && !view && !error;

  const selectedGuild: DiscordDirectoryGuild | undefined = view?.guilds.find(
    (guild) => guild.id === guildId,
  );
  const selectedChannel = selectedGuild?.channels.find((channel) => channel.id === channelId);
  const canSave = Boolean(guildId && channelId && selectedChannel?.canSend && !saving);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/discord/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionCode, guildId, channelId }),
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !body?.ok) {
        setError(body?.error ?? "Falha ao salvar a configuração.");
        return;
      }
      // Salvo com sucesso: fecha o modal (a próxima abertura recarrega sozinha).
      onClose();
    } catch {
      setError("Falha ao conversar com o servidor.");
    } finally {
      setSaving(false);
    }
  }

  const statusMessage = !sessionCode
    ? "Defina um código de mesa antes de configurar o Discord."
    : error
      ? error
      : loading
        ? "Carregando…"
        : view
          ? !view.botReady
            ? "Bot offline — verifique o DISCORD_BOT_TOKEN"
            : view.current
              ? `Conectado — rolagens desta mesa vão para ${
                  view.guilds.find((guild) => guild.id === view.current?.guildId)?.name ??
                  `servidor ${view.current.guildId}`
                }`
              : "Bot conectado — nenhum servidor vinculado a esta mesa ainda"
          : "";

  return (
    <div
      className="discord-panel-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="discord-panel" role="dialog" aria-modal="true" aria-label="Discord Integration">
        <div className="discord-panel-header">
          <div>
            <p className="store-eyebrow">Discord Integration</p>
            <h2>Conectar servidor</h2>
          </div>
          <button type="button" className="discord-panel-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <div className={`discord-status${error ? " discord-status--error" : " discord-status--ok"}`}>
          {statusMessage || "…"}
        </div>

        <p className="consent-hint">
          Mesa: <strong>{sessionCode || "—"}</strong>
        </p>

        {view && view.guilds.length === 0 && (
          <div className="discord-invite-box">
            <p>O bot ainda não está instalado em nenhum servidor que você administra.</p>
            <ol>
              <li>Instale o bot no servidor desejado (permissões apenas de leitura e envio):</li>
            </ol>
            {view.inviteUrl && (
              <a className="discord-invite" href={view.inviteUrl} target="_blank" rel="noreferrer">
                ↑ Instalar o bot no meu servidor
              </a>
            )}
            <ol start={2}>
              <li>Volte aqui e recarregue o painel.</li>
            </ol>
          </div>
        )}

        {view && view.guilds.length > 0 && (
          <>
            <div className="discord-field">
              <label htmlFor="discord-guild">Servidor</label>
              <select
                id="discord-guild"
                className="discord-select"
                value={guildId}
                onChange={(event) => {
                  setGuildId(event.target.value);
                  setChannelId("");
                }}
              >
                <option value="">Selecione um servidor…</option>
                {view.guilds.map((guild) => (
                  <option key={guild.id} value={guild.id}>
                    {guild.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="discord-field">
              <label htmlFor="discord-channel">Canal</label>
              <select
                id="discord-channel"
                className="discord-select"
                value={channelId}
                disabled={!selectedGuild}
                onChange={(event) => {
                  setChannelId(event.target.value);
                }}
              >
                <option value="">
                  {selectedGuild ? "Selecione um canal…" : "Escolha primeiro o servidor"}
                </option>
                {selectedGuild?.channels.map((channel) => (
                  <option key={channel.id} value={channel.id} disabled={!channel.canSend}>
                    # {channel.name}
                    {channel.canSend ? "" : " (sem permissão)"}
                  </option>
                ))}
              </select>
            </div>

            <div className="discord-panel-actions">
              {view.inviteUrl && (
                <a className="discord-invite" href={view.inviteUrl} target="_blank" rel="noreferrer">
                  + Instalar bot em outro servidor
                </a>
              )}
              <button type="button" className="discord-save" onClick={save} disabled={!canSave}>
                {saving ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
