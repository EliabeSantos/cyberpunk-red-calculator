"use client";

export type FloatingUpdate = {
  id: string;
  message: string;
  kind: "ok" | "error" | "result";
};

interface Props {
  updates: FloatingUpdate[];
}

export default function FloatingUpdateCard({ updates }: Props) {
  if (updates.length === 0) return null;

  return (
    <div className="floating-update-stack" aria-live="polite" aria-atomic="false">
      {updates.map((update) => (
        <div className={`floating-update-card ${update.kind}`} key={update.id} role="status">
          <span className="floating-update-mark" aria-hidden="true">
            {update.kind === "error" ? "!" : update.kind === "result" ? "◆" : "✓"}
          </span>
          <span>{update.message}</span>
        </div>
      ))}
    </div>
  );
}
