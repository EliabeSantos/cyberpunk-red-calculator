import { getCreationPointSummary, validateCharacterCreation } from "@/lib/characterCreation";
import type { Character } from "@/types/character";

type Props = { character: Character };
export default function CreationSummary({ character }: Props) {
  const summary = getCreationPointSummary(character); const validation = validateCharacterCreation(character);
  return <section className="creation-summary" aria-live="polite"><div><small>Pontos de atributos</small><strong>{summary.attributePointsRemaining} <i>/ {summary.attributePointsTotal}</i></strong><span>{summary.attributePointsSpent} utilizados</span></div><div><small>Pontos de perícias</small><strong>{summary.skillPointsRemaining} <i>/ {summary.skillPointsTotal}</i></strong><span>{summary.skillPointsPreAllocated} obrigatórios · {summary.skillPointsSpentManual} manuais</span></div>{!validation.valid && <ul>{validation.errors.map((error) => <li key={error}>{error}</li>)}</ul>}</section>;
}