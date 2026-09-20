import type { AttributeName } from "@/types/character";

export type QuickhackCategory = "Simples" | "Padrão" | "Difícil" | "Avançado";

export interface Quickhack {
  id: string;
  name: string;
  category: QuickhackCategory;
  dv: number;
  test: string; // "1d10 + Interface"
  target: string;
  effect: string;
  duration: string;
  notes?: string;
}

export const quickhackDefinitions: Record<string, Quickhack> = {
  impair_movement: {
    id: "impair_movement",
    name: "Impair Movement",
    category: "Simples",
    dv: 6,
    test: "1d10 + Interface",
    target: "Alvo com cyberware compatível",
    effect: "Reduz MOVE em 1. Se MOVE chegar a 0, não pode fazer Move Action.",
    duration: "60 s / 20 rodadas",
    notes: "",
  },
  sonic_shock: {
    id: "sonic_shock",
    name: "Sonic Shock",
    category: "Simples",
    dv: 6,
    test: "1d10 + Interface",
    target: "Alvo com cyberware compatível",
    effect: "Aplica Damaged Ear sem o dano adicional da Critical Injury.",
    duration: "60 s / 20 rodadas",
    notes: "",
  },
  overheat: {
    id: "overheat",
    name: "Overheat",
    category: "Padrão",
    dv: 8,
    test: "1d10 + Interface",
    target: "Alvo compatível",
    effect: "Alvo pega fogo e sofre 4 HP de dano no final de cada turno. Ignora SP e não causa ablação.",
    duration: "Até apagar",
    notes: "Dano ignora SP",
  },
  short_circuit: {
    id: "short_circuit",
    name: "Short Circuit",
    category: "Padrão",
    dv: 8,
    test: "1d10 + Interface",
    target: "Alvo com cyberware",
    effect: "Desativa 3 peças de cyberware escolhidas pelo GM.",
    duration: "60 s / 20 rodadas",
    notes: "",
  },
  cyberware_malfunction: {
    id: "cyberware_malfunction",
    name: "Cyberware Malfunction",
    category: "Difícil",
    dv: 10,
    test: "1d10 + Interface",
    target: "Alvo com cyberware",
    effect: "Desativa 1 peça de cyberware escolhida pelo Netrunner.",
    duration: "60 s / 20 rodadas",
    notes: "",
  },
  lure: {
    id: "lure",
    name: "Lure",
    category: "Difícil",
    dv: 10,
    test: "1d10 + Interface",
    target: "Alvo que não sabe que foi hackeado",
    effect: "No início do próximo turno, o Netrunner controla a Move Action do alvo. Não pode fazê-lo entrar em perigo óbvio.",
    duration: "Próximo turno",
    notes: "Requer que o alvo não saiba que foi hackeado",
  },
  slow: {
    id: "slow",
    name: "Slow",
    category: "Difícil",
    dv: 10,
    test: "1d10 + Interface",
    target: "Alvo compatível",
    effect: "Reduz MOVE em 1d6. Se chegar a 0, não pode fazer Move Action.",
    duration: "60 s / 20 rodadas",
    notes: "",
  },
  synapse_burnout: {
    id: "synapse_burnout",
    name: "Synapse Burnout",
    category: "Difícil",
    dv: 10,
    test: "1d10 + Interface",
    target: "Alvo compatível",
    effect: "Causa 3d6 HP de dano. Ignora SP e não causa ablação.",
    duration: "Instantâneo",
    notes: "Dano ignora SP",
  },
  puppet: {
    id: "puppet",
    name: "Puppet",
    category: "Avançado",
    dv: 12,
    test: "1d10 + Interface",
    target: "Alvo compatível",
    effect: "Netrunner controla a Action e Move Action do alvo no próximo turno.",
    duration: "Próximo turno",
    notes: "Os testes continuam usando as estatísticas do alvo",
  },
  shard_ejection: {
    id: "shard_ejection",
    name: "Shard Ejection",
    category: "Avançado",
    dv: 12,
    test: "1d10 + Interface",
    target: "Alvo com chipware",
    effect: "Ejeta um chipware do alvo para um espaço adjacente.",
    duration: "Instantâneo",
    notes: "",
  },
  system_reset: {
    id: "system_reset",
    name: "System Reset",
    category: "Avançado",
    dv: 12,
    test: "1d10 + Interface",
    target: "Alvo compatível",
    effect: "Deixa o alvo Unconscious e Prone. Sofrer dano pode acordá-lo.",
    duration: "60 s / 20 rodadas",
    notes: "",
  },
};

export const quickhackCategories: Record<QuickhackCategory, { dv: number; order: number }> = {
  Simples: { dv: 6, order: 1 },
  Padrão: { dv: 8, order: 2 },
  Difícil: { dv: 10, order: 3 },
  Avançado: { dv: 12, order: 4 },
};

export const quickhackOrder = Object.keys(quickhackDefinitions).sort(
  (a, b) => {
    const catA = quickhackDefinitions[a].category;
    const catB = quickhackDefinitions[b].category;
    return quickhackCategories[catA].order - quickhackCategories[catB].order;
  },
);

export function createDefaultQuickhacks(): Record<string, Quickhack> {
  return { ...quickhackDefinitions };
}

export const quickhackCategoriesOrder: QuickhackCategory[] = ["Simples", "Padrão", "Difícil", "Avançado"];

export const quickhackCategoryNames: Record<QuickhackCategory, string> = {
  Simples: "Simples",
  Padrão: "Padrão",
  Difícil: "Difícil",
  Avançado: "Avançado",
};

export function getQuickhacksForCharacter(character: { skills: Record<string, { level: number }>; roleAbilities?: { abilityId: string; rank: number }[]; primaryRole?: string | null }): Quickhack[] {
  // Quickhacks só estão disponíveis para personagens com Interface ou que sejam Netrunner
  const hasInterface = character.skills?.interface && character.skills.interface.level > 0;
  const isNetrunner = character.primaryRole === "netrunner" || 
    (character.roleAbilities?.some((ra) => ra.abilityId === "interface" && ra.rank > 0) ?? false);
  
  if (!hasInterface && !isNetrunner) {
    return [];
  }
  
  return Object.values(quickhackDefinitions);
}