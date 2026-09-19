export const hitLocations = ["head", "body", "right_arm", "left_arm", "right_leg", "left_leg"] as const;
export type HitLocation = (typeof hitLocations)[number];
export const hitLocationLabels: Record<HitLocation, string> = { head: "Cabeça", body: "Corpo", right_arm: "Braço Direito", left_arm: "Braço Esquerdo", right_leg: "Perna Direita", left_leg: "Perna Esquerda" };
export function armorSlotForLocation(location: HitLocation): "head" | "body" { return location === "head" ? "head" : "body"; }