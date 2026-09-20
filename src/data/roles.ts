export const roleIds = ["rockerboy", "solo", "netrunner", "tech", "medtech", "media", "exec", "lawman", "fixer", "nomad"] as const;
export type RoleId = (typeof roleIds)[number];

export const roleAbilityIds = ["charismatic_impact", "combat_awareness", "interface", "maker", "medicine", "credibility", "teamwork", "backup", "operator", "moto"] as const;
export type RoleAbilityId = (typeof roleAbilityIds)[number];

export type RoleAbilityLevelEffect = {
  level: number;
  effect: string;
};

export type RoleAbilityData = {
  id: RoleAbilityId;
  name: string;
  description: string;
  effectsByLevel: Record<number, string>;
};

export type RoleDefinition = {
  id: RoleId;
  name: string;
  abilityId: RoleAbilityId;
  abilityName: string;
  abilityData?: RoleAbilityData;
};

export const roleAbilityData: Record<RoleAbilityId, RoleAbilityData> = {
  combat_awareness: {
    id: "combat_awareness",
    name: "Combat Awareness",
    description:
      "Combat Awareness permite que o Solo antecipe perigos em combate, reaja mais rápido e identifique pontos fracos nos inimigos. O Solo ganha pontos de Combat Awareness igual ao seu Rank, que podem ser gastos em especialidades.",
    effectsByLevel: {
      1: "Ganha 1 ponto de Combat Awareness. Pode gastar em especialidades.",
      2: "Ganha 2 pontos de Combat Awareness. Pode gastar em especialidades.",
      3: "Ganha 3 pontos de Combat Awareness. Pode gastar em especialidades.",
      4: "Ganha 4 pontos de Combat Awareness. Acesso a NET Actions: 3 por turno.",
      5: "Ganha 5 pontos de Combat Awareness.",
      6: "Ganha 6 pontos de Combat Awareness. Acesso a NET Actions: 3 por turno.",
      7: "Ganha 7 pontos de Combat Awareness. Acesso a NET Actions: 4 por turno.",
      8: "Ganha 8 pontos de Combat Awareness.",
      9: "Ganha 9 pontos de Combat Awareness. Acesso a NET Actions: 4 por turno.",
      10: "Ganha 10 pontos de Combat Awareness. Acesso a NET Actions: 5 por turno.",
    },
  },
  interface: {
    id: "interface",
    name: "Interface",
    description:
      "Interface permite que o Netrunner acesse a NET, execute quickhacks e manipule sistemas. O rank determina quantas ações NET pode realizar por turno e quais programas estão disponíveis.",
    effectsByLevel: {
      1: "Pode realizar 2 ações NET por turno. Acesso a quickhacks básicos.",
      2: "Pode realizar 2 ações NET por turno. Acesso a quickhacks melhorados.",
      3: "Pode realizar 3 ações NET por turno.",
      4: "Pode realizar 3 ações NET por turno. Acesso a programas avançados.",
      5: "Pode realizar 3 ações NET por turno.",
      6: "Pode realizar 4 ações NET por turno.",
      7: "Pode realizar 4 ações NET por turno. Acesso a programas militares.",
      8: "Pode realizar 4 ações NET por turno.",
      9: "Pode realizar 5 ações NET por turno.",
      10: "Pode realizar 5 ações NET por turno. Acesso a todos os programas.",
    },
  },
  maker: {
    id: "maker",
    name: "Maker",
    description:
      "O Maker pode fabricar, modificar e reparar equipamentos. O rank determina pontos de especialidade e o que pode ser fabricado.",
    effectsByLevel: {
      1: "2 pontos de especialidade. Pode fabricar itens básicos.",
      2: "4 pontos de especialidade.",
      3: "6 pontos de especialidade.",
      4: "8 pontos de especialidade. Pode fabricar itens avançados.",
      5: "10 pontos de especialidade.",
      6: "12 pontos de especialidade.",
      7: "14 pontos de especialidade. Pode fabricar itens militares.",
      8: "16 pontos de especialidade.",
      9: "18 pontos de especialidade.",
      10: "20 pontos de especialidade. Pode fabricar qualquer item.",
    },
  },
  medicine: {
    id: "medicine",
    name: "Medicine",
    description:
      "A habilidade Medicine permite que o Medtech realize cirurgias, prepare fármacos e opere sistemas de suporte vital. O rank determina pontos de especialidade e capacidades médicas.",
    effectsByLevel: {
      1: "1 ponto de especialidade. Primeiros socorros básicos.",
      2: "2 pontos de especialidade.",
      3: "3 pontos de especialidade. Cirurgias simples.",
      4: "4 pontos de especialidade. Cirurgias complexas.",
      5: "5 pontos de especialidade.",
      6: "6 pontos de especialidade. Neurocirurgia.",
      7: "7 pontos de especialidade.",
      8: "8 pontos de especialidade. Cirurgia cibernética avançada.",
      9: "9 pontos de especialidade.",
      10: "10 pontos de especialidade. Qualquer procedimento médico.",
    },
  },
  charismatic_impact: {
    id: "charismatic_impact",
    name: "Charismatic Impact",
    description:
      "Charismatic Impact permite que o Rockerboy influence multidões e ganhe seguidores. O rank determina o alcance da influência e o tamanho da base de fãs.",
    effectsByLevel: {
      1: "Alcance: pequenos clubes. Base de fãs pequena.",
      2: "Alcance: clubes locais.",
      3: "Alcance: local. Base de fãs local.",
      4: "Alcance: local. Base de fãs local.",
      5: "Alcance: municipal. Base de fãs municipal.",
      6: "Alcance: municipal.",
      7: "Alcance: estadual. Base de fãs estadual.",
      8: "Alcance: estadual.",
      9: "Alcance: nacional. Base de fãs nacional.",
      10: "Alcance: internacional. Base de fãs internacional.",
    },
  },
  credibility: {
    id: "credibility",
    name: "Credibility",
    description:
      "Credibility permite que o Media acesse fontes de informação e publique histórias com impacto. O rank determina o alcance e a qualidade das fontes.",
    effectsByLevel: {
      1: "Alcance: local. Fontes locais. Score 2.",
      2: "Alcance: local. Fontes locais.",
      3: "Alcance: cidade. Fontes da cidade. Score 3.",
      4: "Alcance: cidade.",
      5: "Alcance: estadual. Fontes importantes. Score 4.",
      6: "Alcance: estadual.",
      7: "Alcance: nacional. Fontes de alto nível. Score 5.",
      8: "Alcance: nacional.",
      9: "Alcance: nacional. Fontes de altíssimo nível. Score 6.",
      10: "Alcance: mundial. Fontes de altíssimo nível. Score 7.",
    },
  },
  teamwork: {
    id: "teamwork",
    name: "Teamwork",
    description:
      "Teamwork permite que o Exec coordene sua equipe e melhore o desempenho dos aliados. O rank determina bônus para aliados e capacidade de coordenação.",
    effectsByLevel: {
      1: "Pode coordenar 1 aliado. Bônus +1.",
      2: "Pode coordenar 1 aliado. Bônus +1.",
      3: "Pode coordenar 2 aliados. Bônus +2.",
      4: "Pode coordenar 2 aliados. Bônus +2.",
      5: "Pode coordenar 2 aliados. Bônus +3.",
      6: "Pode coordenar 2 aliados. Bônus +3.",
      7: "Pode coordenar 3 aliados. Bônus +3.",
      8: "Pode coordenar 3 aliados. Bônus +3.",
      9: "Pode coordenar 3 aliados. Bônus +4.",
      10: "Pode coordenar 3 aliados. Bônus +4.",
    },
  },
  backup: {
    id: "backup",
    name: "Backup",
    description:
      "Backup permite que o Lawman chame reforços policiais ou de segurança. O rank determina o nível de reforço disponível e o tempo de resposta.",
    effectsByLevel: {
      1: "Segurança Corporativa. Tempo: 1d6+6 min.",
      2: "Segurança Corporativa.",
      3: "Polícia Local. Tempo: 1d6+4 min.",
      4: "Polícia Local.",
      5: "Escritório do Xerife. Tempo: 1d6+2 min.",
      6: "Escritório do Xerife.",
      7: "Zona de Recuperação. Tempo: 1d6 min.",
      8: "C-SWAT. Tempo: 1d6 min.",
      9: "C-SWAT.",
      10: "Força Policial Nacional. Tempo: 1d6 min.",
    },
  },
  operator: {
    id: "operator",
    name: "Operator",
    description:
      "Operator permite que o Fixer acesse contatos, negocie equipamentos e obtenha itens raros. O rank determina o alcance dos contatos e a qualidade dos itens.",
    effectsByLevel: {
      1: "Contatos locais. Itens baratos.",
      2: "Contatos locais.",
      3: "Contatos da cidade. Itens caros.",
      4: "Contatos da cidade.",
      5: "Contatos de elite locais. Itens muito caros.",
      6: "Contatos de elite locais.",
      7: "Contatos nacionais. Itens de luxo.",
      8: "Contatos nacionais.",
      9: "Contatos de elite nacionais. Itens de luxo extremo.",
      10: "Contatos de elite nacionais. Acesso ao Night Market.",
    },
  },
  moto: {
    id: "moto",
    name: "Moto",
    description:
      "Moto permite que o Nomad pilote veículos avançados e modifique veículos da família. O rank determina quais veículos pode pilotar e bônus de pilotagem.",
    effectsByLevel: {
      1: "Pilota: Compact Groundcar, Gyrocopter, Jetski, Roadbike. Bônus +1.",
      2: "Pilota: Compact Groundcar, Gyrocopter, Jetski, Roadbike. Bônus +2.",
      3: "Pilota: Helicopter, High Performance Groundcar, Speedboat. Bônus +3.",
      4: "Pilota: Helicopter, High Performance Groundcar, Speedboat. Bônus +4.",
      5: "Pilota: AV-4, Cabin Cruiser, Superbike. Bônus +5.",
      6: "Pilota: AV-4, Cabin Cruiser, Superbike. Bônus +6.",
      7: "Pilota: AV-9, Aerozep, Super Groundcar, Yacht. Bônus +7.",
      8: "Pilota: AV-9, Aerozep, Super Groundcar, Yacht. Bônus +8.",
      9: "Pilota: AV-9, Aerozep, Super Groundcar, Yacht. Bônus +9.",
      10: "Pilota todos os veículos. Bônus +10.",
    },
  },
};

export const roleDefinitions: Record<RoleId, RoleDefinition> = {
  rockerboy: { id: "rockerboy", name: "Rockerboy", abilityId: "charismatic_impact", abilityName: "Charismatic Impact", abilityData: roleAbilityData.charismatic_impact },
  solo: { id: "solo", name: "Solo", abilityId: "combat_awareness", abilityName: "Combat Awareness", abilityData: roleAbilityData.combat_awareness },
  netrunner: { id: "netrunner", name: "Netrunner", abilityId: "interface", abilityName: "Interface", abilityData: roleAbilityData.interface },
  tech: { id: "tech", name: "Tech", abilityId: "maker", abilityName: "Maker", abilityData: roleAbilityData.maker },
  medtech: { id: "medtech", name: "Medtech", abilityId: "medicine", abilityName: "Medicine", abilityData: roleAbilityData.medicine },
  media: { id: "media", name: "Media", abilityId: "credibility", abilityName: "Credibility", abilityData: roleAbilityData.credibility },
  exec: { id: "exec", name: "Exec", abilityId: "teamwork", abilityName: "Teamwork", abilityData: roleAbilityData.teamwork },
  lawman: { id: "lawman", name: "Lawman", abilityId: "backup", abilityName: "Backup", abilityData: roleAbilityData.backup },
  fixer: { id: "fixer", name: "Fixer", abilityId: "operator", abilityName: "Operator", abilityData: roleAbilityData.operator },
  nomad: { id: "nomad", name: "Nomad", abilityId: "moto", abilityName: "Moto", abilityData: roleAbilityData.moto },
};

export const combatAwarenessSpecialties = ["initiative", "damage", "evasion", "fumble_recovery", "perception", "threat_detection", "spot_weakness"] as const;
export const makerSpecialties = ["field_expertise", "upgrade_expertise", "fabrication_expertise", "invention_expertise"] as const;
export const medicineSpecialties = ["surgery", "pharmaceuticals", "cryosystem_operation"] as const;
export const interfaceAbilities = ["backdoor", "cloak", "control", "eye_dee", "pathfinder", "scanner", "slide", "virus", "zap"] as const;