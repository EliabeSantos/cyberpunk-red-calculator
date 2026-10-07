/**
 * Catálogo único de Cover do VTT.
 *
 * Os HP são os valores da tabela de Cover do Cyberpunk RED. O DV é uma
 * convenção explícita do VTT (o livro não fornece uma tabela de DV para Cover)
 * e fica centralizado aqui para não virar configuração por obstáculo.
 */
export type TacticalCoverThickness = "thin" | "thick";
export type TacticalOfficialCoverMaterial = "wood" | "stone" | "concrete" | "steel" | "ballistic_glass";

export interface TacticalCoverProfile {
  material: TacticalOfficialCoverMaterial;
  thickness: TacticalCoverThickness;
  hp: number;
  /** DV configurável do VTT; não é um valor oficial do livro. */
  dv: number;
}

export const TACTICAL_COVER_MATERIALS = ["wood", "stone", "concrete", "steel", "ballistic_glass"] as const;
export const TACTICAL_COVER_THICKNESSES = ["thin", "thick"] as const;

/** DV deliberadamente uniforme: política do VTT, não inferência de realismo. */
const VTT_COVER_DV = 15;

export const TACTICAL_COVER_PROFILES: readonly TacticalCoverProfile[] = [
  { material: "wood", thickness: "thin", hp: 5, dv: VTT_COVER_DV },
  { material: "wood", thickness: "thick", hp: 20, dv: VTT_COVER_DV },
  { material: "stone", thickness: "thin", hp: 20, dv: VTT_COVER_DV },
  { material: "stone", thickness: "thick", hp: 40, dv: VTT_COVER_DV },
  { material: "ballistic_glass", thickness: "thin", hp: 15, dv: VTT_COVER_DV },
  { material: "ballistic_glass", thickness: "thick", hp: 30, dv: VTT_COVER_DV },
  { material: "concrete", thickness: "thin", hp: 10, dv: VTT_COVER_DV },
  { material: "concrete", thickness: "thick", hp: 25, dv: VTT_COVER_DV },
  { material: "steel", thickness: "thin", hp: 25, dv: VTT_COVER_DV },
  { material: "steel", thickness: "thick", hp: 50, dv: VTT_COVER_DV },
];

const profileByKey = new Map(TACTICAL_COVER_PROFILES.map((profile) => [`${profile.material}:${profile.thickness}`, profile]));

export function getTacticalCoverProfile(material: unknown, thickness: unknown): TacticalCoverProfile | null {
  if (!TACTICAL_COVER_MATERIALS.includes(material as TacticalOfficialCoverMaterial)) return null;
  if (!TACTICAL_COVER_THICKNESSES.includes(thickness as TacticalCoverThickness)) return null;
  return profileByKey.get(`${material}:${thickness}`) ?? null;
}
