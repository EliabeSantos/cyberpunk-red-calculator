export type ThreatLevel = "low" | "medium" | "high" | "extreme";

export const threatLevels: ThreatLevel[] = ["low", "medium", "high", "extreme"];

export const threatLevelLabels: Record<ThreatLevel, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  extreme: "Extrema",
};

export const threatLevelColors: Record<ThreatLevel, string> = {
  low: "#2e7d32",      // Green
  medium: "#f57f17",   // Amber
  high: "#c62828",     // Red
  extreme: "#6a1b9a",  // Purple
};

export const threatLevelDescriptions: Record<ThreatLevel, string> = {
  low: "Ameaça menor - civis, gangues inexperientes, animais",
  medium: "Ameaça padrão - seguranças corporativos, gangers veteranos, policiais",
  high: "Ameaça séria - solos elites, assassinos, cyberpsychos menores",
  extreme: "Ameaça letal - cyberpsychos poderosos, borgs, avatares de IA, bosses",
};

export const archetypeOptions = [
  "Civil",
  "Gang Member",
  "Gang Lieutenant",
  "Gang Leader",
  "Corporate Security",
  "Corporate Elite Guard",
  "Police Officer",
  "SWAT/MaxTac",
  "Solo",
  "Solo Veteran",
  "Assassin",
  "Netrunner",
  "Tech",
  "Medic",
  "Medtech",
  "Rockerboy",
  "Fixer",
  "Nomad",
  "Nomad Leader",
  "Cyberpsycho",
  "Cyberpsycho Prime",
  "Borg / Full Body Conversion",
  "Drone / Robot",
  "Vehicle",
  "Animal / Bioengineered",
  "Other",
] as const;

export type ArchetypeOption = (typeof archetypeOptions)[number];