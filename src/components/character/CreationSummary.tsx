import { getCreationPointSummary, validateCharacterCreation } from "@/lib/characterCreation";
import type { Character } from "@/types/character";

type Props = { character: Character };
export default function CreationSummary({ character }: Props) {
  const summary = getCreationPointSummary(character);
  const validation = validateCharacterCreation(character);
  return (
    <section className="creation-summary" aria-live="polite">
      <div>
        <small>Pontos de STAT</small>
        <strong>{summary.attributePointsSpent} <i>/ {summary.attributePointsTotal}</i></strong>
        <span>{summary.attributePointsRemaining} restantes</span>
      </div>
      <div>
        <small>Pontos de Perícia</small>
        <strong>{summary.skillPointsTotal}</strong>
        <span>{summary.skillPointsPreAllocated} obrigatórios · {summary.skillPointsRemaining} livres restantes</span>
      </div>
      {!validation.valid && <ul>{validation.errors.map((error) => <li key={error}>{error}</li>)}</ul>}
    </section>
  );
}