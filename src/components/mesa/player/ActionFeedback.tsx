"use client";

interface Props {
  busy: boolean;
}

/** Feedback único e discreto para qualquer mutação em voo na tela. */
export default function ActionFeedback({ busy }: Props) {
  if (!busy) return null;

  return (
    <div className="player-mesa-action-feedback" role="status" aria-live="polite">
      <span className="player-mesa-feedback-pulse" aria-hidden="true" />
      <strong>PROCESSING</strong>
      <span>Sincronizando resultado com a Mesa...</span>
    </div>
  );
}
