/**
 * F1.57 — catálogo auditado dos NET Actions.
 *
 * Este catálogo não resolve ações nem mantém estado. Ele documenta o único
 * gateway autorizado e impede que ações sem contrato RAW confirmado sejam
 * expostas acidentalmente pela UI ou pelo cliente.
 */
export const IMPLEMENTED_NET_ACTIONS = ["pathfinder", "backdoor", "control", "zap", "slide"] as const;
export type ImplementedNetAction = typeof IMPLEMENTED_NET_ACTIONS[number];

export const NET_ACTION_AUDIT = {
  pathfinder: { status: "implemented", gateway: "executeNetAction" },
  backdoor: { status: "implemented", gateway: "executeNetAction" },
  control: { status: "implemented", gateway: "executeNetAction" },
  zap: { status: "implemented", gateway: "executeNetAction" },
  slide: { status: "implemented", gateway: "executeNetAction" },
  scanner: { status: "unresolved", reason: "O projeto não confirma custo, DV/teste ou informação revelada; nenhum DV é presumido." },
  eye_on_target: { status: "unresolved", reason: "O projeto não confirma custo, duração, bônus ou integração com Meatspace." },
  target_backpack: { status: "unresolved", reason: "O projeto não confirma alvo, teste ou efeito de inventário." },
  virus: { status: "unresolved", reason: "O projeto não confirma persistência nem efeito RAW do Virus." },
} as const;

export function isImplementedNetAction(value: unknown): value is ImplementedNetAction {
  return typeof value === "string" && (IMPLEMENTED_NET_ACTIONS as readonly string[]).includes(value);
}
