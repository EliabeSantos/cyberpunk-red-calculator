"use client";

import type { DiscordConsent } from "@/lib/discord/consent";

type Props = {
  onDecide: (consent: DiscordConsent) => void;
};

/** Pedido exibido na primeira visita: o usuário decide se as rolagens vão ao Discord. */
export default function DiscordConsentPrompt({ onDecide }: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Envio de rolagens ao Discord">
      <div className="consent-modal">
        <p className="store-eyebrow">Discord</p>
        <h2>🎲 Enviar suas rolagens ao Discord?</h2>
        <p className="consent-text">
          Quando você rolar dados no site, o resultado pode ser publicado em um canal
          do Discord exatamente como aparece aqui. O Discord apenas mostra o resultado —
          nada é rolado por lá e nenhum outro dado é enviado.
        </p>
        <p className="consent-hint">Você pode mudar isso a qualquer momento em 🎲 Dados.</p>
        <div className="consent-actions">
          <button type="button" className="consent-decline" onClick={() => onDecide("denied")}>
            Agora não
          </button>
          <button type="button" className="consent-accept" onClick={() => onDecide("granted")}>
            Sim, enviar
          </button>
        </div>
      </div>
    </div>
  );
}
