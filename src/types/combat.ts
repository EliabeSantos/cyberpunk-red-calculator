export const hitLocations = ["head", "body", "leg", "held_item"] as const;
export type HitLocation = (typeof hitLocations)[number];
export const hitLocationLabels: Record<HitLocation, string> = { head: "Cabeça", body: "Corpo", leg: "Perna", held_item: "Item empunhado" };
export function armorSlotForLocation(location: HitLocation): "head" | "body" { return location === "head" ? "head" : "body"; }
