/**
 * Catálogo de Inimigos do Mestre — integração com JSON fornecido.
 * Mapeia os dados do JSON para a estrutura Enemy já existente no sistema GM.
 */

import type { Enemy, EnemySkill } from "@/types/enemy";

// Mapeamento de nomes de perícia para atributo primário (base do cálculo de base do GM)
const skillStatMap: Record<string, string> = {
  "Evasion": "REF",
  "Handgun": "REF",
  "Shoulder Arms": "REF",
  "Brawling": "REF",
  "Melee Weapon": "REF",
  "Autofire": "REF",
  "Stealth": "REF",
  "Perception": "INT",
  "Athletics": "BODY",
  "Tactics": "INT",
  "Electronics/Security Tech": "TECH",
  "Basic Tech": "TECH",
  "Cybertech": "TECH",
  "Demolitions": "INT",
  "Drive Land Vehicle": "REF",
  "Endurance": "BODY",
  "Throwing Knife": "REF",
};

/** Converte um JSON enemy para o tipo Enemy do sistema. */
function mapJsonToEnemy(json: {
  id: string;
  name: string;
  faction: string;
  role: string;
  level: number;
  stats: Record<string, number>;
  derived: { hp: number; maxHp: number; seriouslyWounded: number; deathSave: number };
  armor: { head: { sp: number }; body: { sp: number } };
  skills: Record<string, number>;
  weapons: Array<{
    id: string;
    name: string;
    skill: string;
    attackBase: number;
    damage: string;
    rof: number;
    ammo: number | null;
    type: string;
  }>;
  cyberware: string[];
  inventory: Array<{ item: string; quantity: number }>;
}): Enemy {
  const now = new Date().toISOString();

  // Mapear skills do JSON para EnemySkill[]
  const skills: Record<string, EnemySkill> = {};
  for (const [skillName, level] of Object.entries(json.skills)) {
    const stat = skillStatMap[skillName] || "REF";
    skills[skillName] = {
      name: skillName,
      stat: stat as Enemy["skills"][string]["stat"],
      level,
    };
  }

  // Mapear armas do JSON para EnemyWeapon[]
  const weapons = json.weapons.map((w) => ({
    id: w.id,
    name: w.name,
    damage: w.damage,
    attackType: (w.type === "ranged" ? "ranged" : "melee") as "ranged" | "melee",
    skill: w.skill,
    rateOfFire: w.rof,
    ammo: w.ammo || undefined,
  }));

  // Construir notas do GM com informações extras
  const gmNotesParts: string[] = [];
  gmNotesParts.push(`Faction: ${json.faction}`);
  gmNotesParts.push(`Role: ${json.role}`);
  gmNotesParts.push(`Level: ${json.level}`);
  gmNotesParts.push(`Seriously Wounded Threshold: ${json.derived.seriouslyWounded}`);
  gmNotesParts.push(`Death Save Penalty: ${json.derived.deathSave}`);
  if (json.cyberware.length > 0) {
    gmNotesParts.push(`Cyberware: ${json.cyberware.join(", ")}`);
  }
  if (json.inventory.length > 0) {
    const invParts = json.inventory.map((i) => `${i.item} (${i.quantity})`);
    gmNotesParts.push(`Inventory: ${invParts.join(", ")}`);
  }

  return {
    id: json.id,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    identity: {
      name: json.name,
      archetype: json.role,
      threatLevel: json.level <= 1 ? "low" : json.level <= 2 ? "medium" : json.level <= 3 ? "high" : "extreme",
      faction: json.faction,
      role: json.role,
    },
    stats: json.stats as Enemy["stats"],
    skills,
    weapons,
    combat: {
      hp: {
        current: json.derived.hp,
        max: json.derived.maxHp,
      },
      armor: {
        head: json.armor.head.sp,
        body: json.armor.body.sp,
      },
      criticalInjuries: [],
    },
    gmNotes: gmNotesParts.join("\n"),
    conditions: [],
  };
}

// ─── DADOS DO CATÁLOGO ───

const catalogEnemies = [
  // 6th Street
  {
    id: "6th_street_recruit", name: "6th Street Recruit", faction: "6th Street", role: "Ranged Mook", level: 1,
    stats: { INT: 5, REF: 6, DEX: 5, TECH: 4, COOL: 5, WILL: 5, LUCK: 3, MOVE: 5, BODY: 5, EMP: 4 },
    derived: { hp: 35, maxHp: 35, seriouslyWounded: 18, deathSave: 5 },
    armor: { head: { sp: 11 }, body: { sp: 11 } },
    skills: { Evasion: 5, Handgun: 6, "Shoulder Arms": 5, Brawling: 4, Athletics: 5, Perception: 5, Stealth: 4, Tactics: 4 },
    weapons: [
      { id: "heavy_pistol", name: "Heavy Pistol", skill: "Handgun", attackBase: 12, damage: "3d6", rof: 2, ammo: 8, type: "ranged" },
      { id: "heavy_melee", name: "Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 9, damage: "3d6", rof: 2, ammo: null, type: "melee" }
    ],
    cyberware: [], inventory: [{ item: "Agent", quantity: 1 }, { item: "Heavy Pistol Ammo", quantity: 16 }, { item: "Radio", quantity: 1 }]
  },
  {
    id: "6th_street_rifleman", name: "6th Street Rifleman", faction: "6th Street", role: "Ranged Soldier", level: 2,
    stats: { INT: 6, REF: 7, DEX: 6, TECH: 5, COOL: 6, WILL: 6, LUCK: 4, MOVE: 6, BODY: 6, EMP: 4 },
    derived: { hp: 40, maxHp: 40, seriouslyWounded: 20, deathSave: 6 },
    armor: { head: { sp: 11 }, body: { sp: 11 } },
    skills: { Evasion: 6, "Shoulder Arms": 8, Autofire: 6, Handgun: 6, Brawling: 5, Athletics: 6, Perception: 6, Tactics: 6 },
    weapons: [
      { id: "assault_rifle", name: "Assault Rifle", skill: "Shoulder Arms", attackBase: 15, damage: "5d6", rof: 1, ammo: 25, type: "ranged" },
      { id: "heavy_pistol", name: "Heavy Pistol", skill: "Handgun", attackBase: 12, damage: "3d6", rof: 2, ammo: 8, type: "ranged" }
    ],
    cyberware: ["Cybereye", "Targeting Scope"], inventory: [{ item: "Agent", quantity: 1 }, { item: "Assault Rifle Ammo", quantity: 50 }, { item: "Heavy Pistol Ammo", quantity: 16 }, { item: "Combat Radio", quantity: 1 }]
  },
  {
    id: "6th_street_heavy", name: "6th Street Heavy", faction: "6th Street", role: "Heavy Gunner", level: 3,
    stats: { INT: 5, REF: 7, DEX: 6, TECH: 5, COOL: 7, WILL: 7, LUCK: 3, MOVE: 5, BODY: 8, EMP: 3 },
    derived: { hp: 50, maxHp: 50, seriouslyWounded: 25, deathSave: 8 },
    armor: { head: { sp: 13 }, body: { sp: 13 } },
    skills: { Evasion: 6, "Shoulder Arms": 8, Autofire: 8, "Heavy Weapons": 6, Brawling: 7, Athletics: 7, Perception: 5, Tactics: 7 },
    weapons: [
      { id: "heavy_machine_gun", name: "Heavy Machine Gun", skill: "Heavy Weapons", attackBase: 13, damage: "6d6", rof: 1, ammo: 50, type: "ranged" },
      { id: "heavy_melee", name: "Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 10, damage: "3d6", rof: 2, ammo: null, type: "melee" }
    ],
    cyberware: ["Grafted Muscle and Bone Lace", "Cybereye"], inventory: [{ item: "Ammo", quantity: 100 }, { item: "Grenade", quantity: 2 }, { item: "Agent", quantity: 1 }]
  },
  {
    id: "6th_street_veteran", name: "6th Street Veteran", faction: "6th Street", role: "Combat Veteran", level: 4,
    stats: { INT: 7, REF: 8, DEX: 7, TECH: 6, COOL: 7, WILL: 7, LUCK: 5, MOVE: 6, BODY: 7, EMP: 4 },
    derived: { hp: 50, maxHp: 50, seriouslyWounded: 25, deathSave: 7 },
    armor: { head: { sp: 13 }, body: { sp: 13 } },
    skills: { Evasion: 8, "Shoulder Arms": 9, Autofire: 8, Handgun: 8, "Melee Weapon": 7, Brawling: 7, Perception: 8, Tactics: 8 },
    weapons: [
      { id: "assault_rifle", name: "Assault Rifle", skill: "Shoulder Arms", attackBase: 17, damage: "5d6", rof: 1, ammo: 25, type: "ranged" },
      { id: "heavy_pistol", name: "Heavy Pistol", skill: "Handgun", attackBase: 15, damage: "3d6", rof: 2, ammo: 8, type: "ranged" }
    ],
    cyberware: ["Cybereye", "Targeting Scope", "Grafted Muscle and Bone Lace"], inventory: [{ item: "Ammo", quantity: 75 }, { item: "Grenade", quantity: 2 }, { item: "Trauma Patch", quantity: 1 }, { item: "Agent", quantity: 1 }]
  },
  {
    id: "6th_street_sergeant", name: "6th Street Sergeant", faction: "6th Street", role: "Squad Leader", level: 5,
    stats: { INT: 7, REF: 8, DEX: 7, TECH: 6, COOL: 8, WILL: 8, LUCK: 6, MOVE: 6, BODY: 8, EMP: 3 },
    derived: { hp: 50, maxHp: 50, seriouslyWounded: 25, deathSave: 8 },
    armor: { head: { sp: 13 }, body: { sp: 13 } },
    skills: { Evasion: 8, "Shoulder Arms": 10, Autofire: 9, Handgun: 9, "Melee Weapon": 8, Brawling: 8, Perception: 8, Tactics: 10 },
    weapons: [
      { id: "assault_rifle", name: "Assault Rifle", skill: "Shoulder Arms", attackBase: 18, damage: "5d6", rof: 1, ammo: 25, type: "ranged" },
      { id: "heavy_pistol", name: "Heavy Pistol", skill: "Handgun", attackBase: 17, damage: "3d6", rof: 2, ammo: 8, type: "ranged" }
    ],
    cyberware: ["Cybereye", "Targeting Scope", "Grafted Muscle and Bone Lace", "Cyberarm"], inventory: [{ item: "Ammo", quantity: 100 }, { item: "Grenade", quantity: 3 }, { item: "Trauma Patch", quantity: 2 }, { item: "Agent", quantity: 1 }]
  },
  // Maelstrom
  {
    id: "maelstrom_scrapper", name: "Maelstrom Scrapper", faction: "Maelstrom", role: "Melee Mook", level: 1,
    stats: { INT: 4, REF: 5, DEX: 6, TECH: 5, COOL: 4, WILL: 6, LUCK: 2, MOVE: 6, BODY: 7, EMP: 2 },
    derived: { hp: 45, maxHp: 45, seriouslyWounded: 23, deathSave: 7 },
    armor: { head: { sp: 11 }, body: { sp: 11 } },
    skills: { Evasion: 5, Brawling: 8, "Melee Weapon": 8, Athletics: 7, Perception: 4, Tactics: 3 },
    weapons: [
      { id: "heavy_melee", name: "Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 14, damage: "3d6", rof: 2, ammo: null, type: "melee" },
      { id: "brawling", name: "Brawling", skill: "Brawling", attackBase: 14, damage: "3d6", rof: 2, ammo: null, type: "melee" }
    ],
    cyberware: ["Cybereye", "Cyberarm"], inventory: [{ item: "Techtool", quantity: 1 }, { item: "Scrap Parts", quantity: 3 }]
  },
  {
    id: "maelstrom_gunner", name: "Maelstrom Gunner", faction: "Maelstrom", role: "Autofire Specialist", level: 2,
    stats: { INT: 5, REF: 7, DEX: 6, TECH: 6, COOL: 5, WILL: 6, LUCK: 3, MOVE: 6, BODY: 6, EMP: 2 },
    derived: { hp: 40, maxHp: 40, seriouslyWounded: 20, deathSave: 6 },
    armor: { head: { sp: 11 }, body: { sp: 11 } },
    skills: { Evasion: 6, Autofire: 9, "Shoulder Arms": 7, Handgun: 6, Brawling: 6, Athletics: 6, Perception: 5, Tactics: 5 },
    weapons: [
      { id: "smg", name: "SMG", skill: "Autofire", attackBase: 16, damage: "2d6", rof: 1, ammo: 40, type: "ranged" },
      { id: "heavy_pistol", name: "Heavy Pistol", skill: "Handgun", attackBase: 13, damage: "3d6", rof: 2, ammo: 8, type: "ranged" }
    ],
    cyberware: ["Cybereye", "Targeting Scope", "Cyberarm"], inventory: [{ item: "SMG Ammo", quantity: 80 }, { item: "Heavy Pistol Ammo", quantity: 16 }, { item: "Cyberdeck Scrap", quantity: 1 }]
  },
  {
    id: "maelstrom_berserker", name: "Maelstrom Berserker", faction: "Maelstrom", role: "Heavy Melee", level: 3,
    stats: { INT: 4, REF: 7, DEX: 7, TECH: 5, COOL: 5, WILL: 8, LUCK: 2, MOVE: 6, BODY: 9, EMP: 1 },
    derived: { hp: 55, maxHp: 55, seriouslyWounded: 28, deathSave: 9 },
    armor: { head: { sp: 13 }, body: { sp: 13 } },
    skills: { Evasion: 7, "Melee Weapon": 10, Brawling: 10, Athletics: 9, Perception: 4, Tactics: 4 },
    weapons: [
      { id: "very_heavy_melee", name: "Very Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 17, damage: "4d6", rof: 1, ammo: null, type: "melee" },
      { id: "brawling", name: "Brawling", skill: "Brawling", attackBase: 17, damage: "3d6", rof: 2, ammo: null, type: "melee" }
    ],
    cyberware: ["Grafted Muscle and Bone Lace", "Cyberarm", "Cybereye"], inventory: [{ item: "Combat Stim", quantity: 1 }, { item: "Trauma Patch", quantity: 1 }, { item: "Scrap Parts", quantity: 5 }]
  },
  {
    id: "maelstrom_techie", name: "Maelstrom Techie", faction: "Maelstrom", role: "Combat Tech", level: 4,
    stats: { INT: 7, REF: 7, DEX: 6, TECH: 9, COOL: 5, WILL: 6, LUCK: 4, MOVE: 5, BODY: 6, EMP: 2 },
    derived: { hp: 40, maxHp: 40, seriouslyWounded: 20, deathSave: 6 },
    armor: { head: { sp: 11 }, body: { sp: 11 } },
    skills: { Evasion: 6, Handgun: 8, "Electronics/Security Tech": 10, "Basic Tech": 10, "Cybertech": 10, Demolitions: 8, Perception: 7, Tactics: 6 },
    weapons: [
      { id: "heavy_pistol", name: "Heavy Pistol", skill: "Handgun", attackBase: 15, damage: "3d6", rof: 2, ammo: 8, type: "ranged" },
      { id: "grenade", name: "Grenade", skill: "Demolitions", attackBase: 17, damage: "6d6", rof: 1, ammo: 3, type: "ranged" }
    ],
    cyberware: ["Neural Link", "Cybereye", "Cyberarm"], inventory: [{ item: "Grenade", quantity: 3 }, { item: "Techtool", quantity: 1 }, { item: "Cyberdeck", quantity: 1 }, { item: "Spare Parts", quantity: 5 }]
  },
  {
    id: "maelstrom_cyborg", name: "Maelstrom Cyborg", faction: "Maelstrom", role: "Cybernetic Enforcer", level: 5,
    stats: { INT: 5, REF: 8, DEX: 8, TECH: 6, COOL: 6, WILL: 8, LUCK: 3, MOVE: 7, BODY: 10, EMP: 1 },
    derived: { hp: 60, maxHp: 60, seriouslyWounded: 30, deathSave: 10 },
    armor: { head: { sp: 15 }, body: { sp: 15 } },
    skills: { Evasion: 8, "Melee Weapon": 11, Brawling: 11, Autofire: 9, "Shoulder Arms": 9, Athletics: 10, Perception: 6, Tactics: 7 },
    weapons: [
      { id: "assault_rifle", name: "Assault Rifle", skill: "Shoulder Arms", attackBase: 17, damage: "5d6", rof: 1, ammo: 25, type: "ranged" },
      { id: "mantis_blades", name: "Mantis Blades", skill: "Melee Weapon", attackBase: 19, damage: "3d6", rof: 2, ammo: null, type: "melee" }
    ],
    cyberware: ["Neural Link", "Cyberarm", "Cybereye", "Grafted Muscle and Bone Lace", "Pain Editor"], inventory: [{ item: "Assault Rifle Ammo", quantity: 50 }, { item: "Trauma Patch", quantity: 2 }, { item: "Combat Stim", quantity: 2 }]
  },
  // Tyger Claws
  {
    id: "tyger_claws_street_fighter", name: "Tyger Claws Street Fighter", faction: "Tyger Claws", role: "Melee Mook", level: 1,
    stats: { INT: 5, REF: 7, DEX: 7, TECH: 4, COOL: 6, WILL: 5, LUCK: 4, MOVE: 7, BODY: 5, EMP: 5 },
    derived: { hp: 35, maxHp: 35, seriouslyWounded: 18, deathSave: 5 },
    armor: { head: { sp: 11 }, body: { sp: 11 } },
    skills: { Evasion: 7, "Melee Weapon": 8, Brawling: 7, Athletics: 6, Stealth: 7, Perception: 5, Tactics: 4 },
    weapons: [
      { id: "medium_melee", name: "Medium Melee Weapon", skill: "Melee Weapon", attackBase: 15, damage: "2d6", rof: 2, ammo: null, type: "melee" },
      { id: "brawling", name: "Brawling", skill: "Brawling", attackBase: 14, damage: "2d6", rof: 2, ammo: null, type: "melee" }
    ],
    cyberware: ["Cybereye"], inventory: [{ item: "Knife", quantity: 1 }, { item: "Agent", quantity: 1 }]
  },
  {
    id: "tyger_claws_pistolero", name: "Tyger Claws Pistolero", faction: "Tyger Claws", role: "Gunfighter", level: 2,
    stats: { INT: 5, REF: 8, DEX: 7, TECH: 4, COOL: 7, WILL: 5, LUCK: 5, MOVE: 7, BODY: 5, EMP: 5 },
    derived: { hp: 35, maxHp: 35, seriouslyWounded: 18, deathSave: 5 },
    armor: { head: { sp: 11 }, body: { sp: 11 } },
    skills: { Evasion: 8, Handgun: 10, "Melee Weapon": 7, Brawling: 6, Athletics: 6, Stealth: 8, Perception: 6, Tactics: 5 },
    weapons: [
      { id: "heavy_pistol", name: "Heavy Pistol", skill: "Handgun", attackBase: 18, damage: "3d6", rof: 2, ammo: 8, type: "ranged" },
      { id: "very_heavy_pistol", name: "Very Heavy Pistol", skill: "Handgun", attackBase: 17, damage: "4d6", rof: 1, ammo: 8, type: "ranged" }
    ],
    cyberware: ["Cybereye", "Targeting Scope"], inventory: [{ item: "Heavy Pistol Ammo", quantity: 24 }, { item: "Smoke Grenade", quantity: 1 }, { item: "Agent", quantity: 1 }]
  },
  {
    id: "tyger_claws_ninja", name: "Tyger Claws Ninja", faction: "Tyger Claws", role: "Stealth Assassin", level: 3,
    stats: { INT: 6, REF: 8, DEX: 9, TECH: 5, COOL: 7, WILL: 6, LUCK: 4, MOVE: 8, BODY: 6, EMP: 4 },
    derived: { hp: 40, maxHp: 40, seriouslyWounded: 20, deathSave: 6 },
    armor: { head: { sp: 11 }, body: { sp: 11 } },
    skills: { Evasion: 10, "Melee Weapon": 10, Brawling: 8, Stealth: 11, Athletics: 9, Handgun: 8, Perception: 7, Tactics: 6 },
    weapons: [
      { id: "very_heavy_melee", name: "Very Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 19, damage: "4d6", rof: 1, ammo: null, type: "melee" },
      { id: "heavy_pistol", name: "Heavy Pistol", skill: "Handgun", attackBase: 16, damage: "3d6", rof: 2, ammo: 8, type: "ranged" }
    ],
    cyberware: ["Kerenzikov", "Cybereye", "Optical Camo"], inventory: [{ item: "Throwing Knife", quantity: 3 }, { item: "Heavy Pistol Ammo", quantity: 16 }, { item: "Smoke Grenade", quantity: 2 }]
  },
  {
    id: "tyger_claws_enforcer", name: "Tyger Claws Enforcer", faction: "Tyger Claws", role: "Enforcer", level: 4,
    stats: { INT: 6, REF: 8, DEX: 7, TECH: 5, COOL: 7, WILL: 7, LUCK: 4, MOVE: 6, BODY: 7, EMP: 3 },
    derived: { hp: 45, maxHp: 45, seriouslyWounded: 23, deathSave: 7 },
    armor: { head: { sp: 13 }, body: { sp: 13 } },
    skills: { Evasion: 8, Handgun: 9, "Melee Weapon": 10, Brawling: 8, Athletics: 8, Stealth: 7, Perception: 6, Tactics: 7 },
    weapons: [
      { id: "very_heavy_pistol", name: "Very Heavy Pistol", skill: "Handgun", attackBase: 17, damage: "4d6", rof: 1, ammo: 8, type: "ranged" },
      { id: "very_heavy_melee", name: "Very Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 18, damage: "4d6", rof: 1, ammo: null, type: "melee" }
    ],
    cyberware: ["Cyberarm", "Kerenzikov", "Cybereye"], inventory: [{ item: "Ammo", quantity: 32 }, { item: "Smoke Grenade", quantity: 2 }, { item: "Trauma Patch", quantity: 1 }]
  },
  {
    id: "tyger_claws_captain", name: "Tyger Claws Captain", faction: "Tyger Claws", role: "Gang Captain", level: 5,
    stats: { INT: 7, REF: 9, DEX: 8, TECH: 6, COOL: 9, WILL: 8, LUCK: 6, MOVE: 7, BODY: 7, EMP: 4 },
    derived: { hp: 50, maxHp: 50, seriouslyWounded: 25, deathSave: 7 },
    armor: { head: { sp: 13 }, body: { sp: 13 } },
    skills: { Evasion: 10, Handgun: 11, "Melee Weapon": 10, Brawling: 9, Athletics: 8, Stealth: 9, Perception: 8, Tactics: 10 },
    weapons: [
      { id: "very_heavy_pistol", name: "Very Heavy Pistol", skill: "Handgun", attackBase: 20, damage: "4d6", rof: 1, ammo: 8, type: "ranged" },
      { id: "very_heavy_melee", name: "Very Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 19, damage: "4d6", rof: 1, ammo: null, type: "melee" }
    ],
    cyberware: ["Kerenzikov", "Cybereye", "Targeting Scope", "Cyberarm"], inventory: [{ item: "Ammo", quantity: 40 }, { item: "Smoke Grenade", quantity: 2 }, { item: "Trauma Patch", quantity: 2 }, { item: "Agent", quantity: 1 }]
  },
  // Valentinos
  {
    id: "valentinos_cholo", name: "Valentino Street Soldier", faction: "Valentinos", role: "Street Fighter", level: 1,
    stats: { INT: 5, REF: 6, DEX: 6, TECH: 4, COOL: 7, WILL: 5, LUCK: 4, MOVE: 6, BODY: 5, EMP: 6 },
    derived: { hp: 35, maxHp: 35, seriouslyWounded: 18, deathSave: 5 },
    armor: { head: { sp: 11 }, body: { sp: 11 } },
    skills: { Evasion: 6, Handgun: 7, "Melee Weapon": 7, Brawling: 7, Athletics: 6, Stealth: 5, Perception: 5, Tactics: 3 },
    weapons: [
      { id: "medium_pistol", name: "Medium Pistol", skill: "Handgun", attackBase: 13, damage: "2d6", rof: 2, ammo: 12, type: "ranged" },
      { id: "medium_melee", name: "Medium Melee Weapon", skill: "Melee Weapon", attackBase: 13, damage: "2d6", rof: 2, ammo: null, type: "melee" }
    ],
    cyberware: [], inventory: [{ item: "Medium Pistol Ammo", quantity: 24 }, { item: "Agent", quantity: 1 }]
  },
  {
    id: "valentinos_shooter", name: "Valentino Shooter", faction: "Valentinos", role: "Ranged Fighter", level: 2,
    stats: { INT: 6, REF: 7, DEX: 7, TECH: 5, COOL: 8, WILL: 5, LUCK: 5, MOVE: 6, BODY: 5, EMP: 6 },
    derived: { hp: 35, maxHp: 35, seriouslyWounded: 18, deathSave: 5 },
    armor: { head: { sp: 11 }, body: { sp: 11 } },
    skills: { Evasion: 7, Handgun: 9, "Shoulder Arms": 7, "Melee Weapon": 6, Brawling: 6, Athletics: 6, Perception: 6, Tactics: 5 },
    weapons: [
      { id: "heavy_pistol", name: "Heavy Pistol", skill: "Handgun", attackBase: 16, damage: "3d6", rof: 2, ammo: 8, type: "ranged" },
      { id: "shotgun", name: "Shotgun", skill: "Shoulder Arms", attackBase: 14, damage: "5d6", rof: 1, ammo: 4, type: "ranged" }
    ],
    cyberware: ["Cybereye"], inventory: [{ item: "Heavy Pistol Ammo", quantity: 16 }, { item: "Shotgun Shells", quantity: 8 }, { item: "Rosary", quantity: 1 }]
  },
  {
    id: "valentinos_brawler", name: "Valentino Brawler", faction: "Valentinos", role: "Brawler", level: 3,
    stats: { INT: 5, REF: 7, DEX: 8, TECH: 4, COOL: 7, WILL: 7, LUCK: 4, MOVE: 7, BODY: 8, EMP: 5 },
    derived: { hp: 50, maxHp: 50, seriouslyWounded: 25, deathSave: 8 },
    armor: { head: { sp: 11 }, body: { sp: 11 } },
    skills: { Evasion: 8, Brawling: 10, "Melee Weapon": 8, Athletics: 9, Handgun: 6, Stealth: 5, Perception: 5, Tactics: 5 },
    weapons: [
      { id: "brawling", name: "Brawling", skill: "Brawling", attackBase: 18, damage: "3d6", rof: 2, ammo: null, type: "melee" },
      { id: "heavy_melee", name: "Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 16, damage: "3d6", rof: 2, ammo: null, type: "melee" }
    ],
    cyberware: ["Grafted Muscle and Bone Lace", "Cyberarm"], inventory: [{ item: "Trauma Patch", quantity: 1 }, { item: "Gold Chain", quantity: 1 }]
  },
  {
    id: "valentinos_driver", name: "Valentino Wheelman", faction: "Valentinos", role: "Combat Driver", level: 4,
    stats: { INT: 6, REF: 8, DEX: 7, TECH: 6, COOL: 8, WILL: 6, LUCK: 5, MOVE: 7, BODY: 6, EMP: 5 },
    derived: { hp: 40, maxHp: 40, seriouslyWounded: 20, deathSave: 6 },
    armor: { head: { sp: 11 }, body: { sp: 11 } },
    skills: { Evasion: 8, Handgun: 8, Autofire: 8, "Drive Land Vehicle": 10, "Melee Weapon": 7, Athletics: 6, Perception: 7, Tactics: 7 },
    weapons: [
      { id: "smg", name: "SMG", skill: "Autofire", attackBase: 16, damage: "2d6", rof: 1, ammo: 40, type: "ranged" },
      { id: "heavy_pistol", name: "Heavy Pistol", skill: "Handgun", attackBase: 16, damage: "3d6", rof: 2, ammo: 8, type: "ranged" }
    ],
    cyberware: ["Neural Link", "Cybereye"], inventory: [{ item: "SMG Ammo", quantity: 80 }, { item: "Heavy Pistol Ammo", quantity: 16 }, { item: "Vehicle Toolkit", quantity: 1 }]
  },
  {
    id: "valentinos_el_jefe", name: "Valentino Lieutenant", faction: "Valentinos", role: "Gang Lieutenant", level: 5,
    stats: { INT: 7, REF: 8, DEX: 8, TECH: 6, COOL: 9, WILL: 8, LUCK: 6, MOVE: 7, BODY: 7, EMP: 5 },
    derived: { hp: 50, maxHp: 50, seriouslyWounded: 25, deathSave: 7 },
    armor: { head: { sp: 13 }, body: { sp: 13 } },
    skills: { Evasion: 9, Handgun: 10, "Melee Weapon": 10, Brawling: 8, Autofire: 8, Athletics: 8, Perception: 8, Tactics: 10 },
    weapons: [
      { id: "very_heavy_pistol", name: "Very Heavy Pistol", skill: "Handgun", attackBase: 20, damage: "4d6", rof: 1, ammo: 8, type: "ranged" },
      { id: "very_heavy_melee", name: "Very Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 18, damage: "4d6", rof: 1, ammo: null, type: "melee" }
    ],
    cyberware: ["Kerenzikov", "Cyberarm", "Cybereye", "Targeting Scope"], inventory: [{ item: "Ammo", quantity: 40 }, { item: "Trauma Patch", quantity: 2 }, { item: "Grenade", quantity: 2 }, { item: "Agent", quantity: 1 }]
  },
  // Animals
  {
    id: "animals_brawler", name: "Animals Brawler", faction: "Animals", role: "Heavy Brawler", level: 1,
    stats: { INT: 4, REF: 6, DEX: 7, TECH: 3, COOL: 5, WILL: 8, LUCK: 2, MOVE: 6, BODY: 9, EMP: 2 },
    derived: { hp: 55, maxHp: 55, seriouslyWounded: 28, deathSave: 9 },
    armor: { head: { sp: 11 }, body: { sp: 11 } },
    skills: { Evasion: 6, Brawling: 10, "Melee Weapon": 7, Athletics: 10, "Endurance": 9, Perception: 4, Tactics: 3 },
    weapons: [{ id: "brawling", name: "Brawling", skill: "Brawling", attackBase: 17, damage: "4d6", rof: 2, ammo: null, type: "melee" }],
    cyberware: ["Grafted Muscle and Bone Lace"], inventory: [{ item: "Combat Stim", quantity: 1 }, { item: "Protein Pack", quantity: 2 }]
  },
  {
    id: "animals_heavy", name: "Animals Heavy", faction: "Animals", role: "Heavy Melee", level: 2,
    stats: { INT: 4, REF: 7, DEX: 7, TECH: 4, COOL: 5, WILL: 8, LUCK: 2, MOVE: 6, BODY: 10, EMP: 2 },
    derived: { hp: 55, maxHp: 55, seriouslyWounded: 28, deathSave: 10 },
    armor: { head: { sp: 13 }, body: { sp: 13 } },
    skills: { Evasion: 7, Brawling: 11, "Melee Weapon": 9, Athletics: 11, "Endurance": 10, Perception: 5, Tactics: 4 },
    weapons: [
      { id: "very_heavy_melee", name: "Very Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 18, damage: "4d6", rof: 1, ammo: null, type: "melee" },
      { id: "brawling", name: "Brawling", skill: "Brawling", attackBase: 18, damage: "4d6", rof: 2, ammo: null, type: "melee" }
    ],
    cyberware: ["Grafted Muscle and Bone Lace", "Cyberarm"], inventory: [{ item: "Combat Stim", quantity: 2 }, { item: "Trauma Patch", quantity: 1 }]
  },
  {
    id: "animals_charger", name: "Animals Charger", faction: "Animals", role: "Assault Fighter", level: 3,
    stats: { INT: 5, REF: 7, DEX: 7, TECH: 4, COOL: 6, WILL: 9, LUCK: 3, MOVE: 7, BODY: 10, EMP: 1 },
    derived: { hp: 60, maxHp: 60, seriouslyWounded: 30, deathSave: 10 },
    armor: { head: { sp: 13 }, body: { sp: 13 } },
    skills: { Evasion: 8, Brawling: 11, "Melee Weapon": 10, Handgun: 7, Athletics: 12, "Endurance": 11, Perception: 5, Tactics: 5 },
    weapons: [
      { id: "very_heavy_melee", name: "Very Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 20, damage: "4d6", rof: 1, ammo: null, type: "melee" },
      { id: "heavy_pistol", name: "Heavy Pistol", skill: "Handgun", attackBase: 15, damage: "3d6", rof: 2, ammo: 8, type: "ranged" }
    ],
    cyberware: ["Grafted Muscle and Bone Lace", "Cyberarm", "Kerenzikov"], inventory: [{ item: "Heavy Pistol Ammo", quantity: 16 }, { item: "Combat Stim", quantity: 2 }, { item: "Trauma Patch", quantity: 2 }]
  },
  {
    id: "animals_enforcer", name: "Animals Enforcer", faction: "Animals", role: "Enforcer", level: 4,
    stats: { INT: 5, REF: 8, DEX: 8, TECH: 5, COOL: 6, WILL: 9, LUCK: 3, MOVE: 7, BODY: 10, EMP: 1 },
    derived: { hp: 60, maxHp: 60, seriouslyWounded: 30, deathSave: 10 },
    armor: { head: { sp: 15 }, body: { sp: 15 } },
    skills: { Evasion: 9, Brawling: 12, "Melee Weapon": 11, Autofire: 8, Handgun: 8, Athletics: 12, "Endurance": 12, Tactics: 6 },
    weapons: [
      { id: "smg", name: "SMG", skill: "Autofire", attackBase: 16, damage: "2d6", rof: 1, ammo: 40, type: "ranged" },
      { id: "very_heavy_melee", name: "Very Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 21, damage: "4d6", rof: 1, ammo: null, type: "melee" }
    ],
    cyberware: ["Grafted Muscle and Bone Lace", "Cyberarm", "Kerenzikov", "Pain Editor"], inventory: [{ item: "SMG Ammo", quantity: 80 }, { item: "Combat Stim", quantity: 3 }, { item: "Trauma Patch", quantity: 2 }]
  },
  {
    id: "animals_alpha", name: "Animals Alpha", faction: "Animals", role: "Gang Champion", level: 5,
    stats: { INT: 6, REF: 9, DEX: 9, TECH: 5, COOL: 8, WILL: 10, LUCK: 5, MOVE: 8, BODY: 10, EMP: 1 },
    derived: { hp: 60, maxHp: 60, seriouslyWounded: 30, deathSave: 10 },
    armor: { head: { sp: 15 }, body: { sp: 15 } },
    skills: { Evasion: 10, Brawling: 13, "Melee Weapon": 12, Autofire: 9, Handgun: 9, Athletics: 13, "Endurance": 13, Tactics: 8 },
    weapons: [
      { id: "very_heavy_melee", name: "Very Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 21, damage: "4d6", rof: 1, ammo: null, type: "melee" },
      { id: "heavy_pistol", name: "Heavy Pistol", skill: "Handgun", attackBase: 18, damage: "3d6", rof: 2, ammo: 8, type: "ranged" }
    ],
    cyberware: ["Grafted Muscle and Bone Lace", "Cyberarm", "Kerenzikov", "Pain Editor", "Cybereye"], inventory: [{ item: "Heavy Pistol Ammo", quantity: 24 }, { item: "Combat Stim", quantity: 3 }, { item: "Trauma Patch", quantity: 3 }, { item: "Grenade", quantity: 2 }]
  },
  // Rapinas
  {
    id: "rapinas_runner", name: "Rapinas Runner", faction: "Rapinas", role: "Street Mook", level: 1,
    stats: { INT: 4, REF: 6, DEX: 6, TECH: 4, COOL: 5, WILL: 5, LUCK: 3, MOVE: 6, BODY: 5, EMP: 4 },
    derived: { hp: 30, maxHp: 30, seriouslyWounded: 15, deathSave: 5 },
    armor: { head: { sp: 7 }, body: { sp: 7 } },
    skills: { Evasion: 5, Handgun: 6, "Melee Weapon": 5, Brawling: 5, Athletics: 6, Stealth: 6, Perception: 4, Tactics: 2 },
    weapons: [
      { id: "medium_pistol", name: "Medium Pistol", skill: "Handgun", attackBase: 12, damage: "2d6", rof: 2, ammo: 12, type: "ranged" },
      { id: "light_melee", name: "Light Melee Weapon", skill: "Melee Weapon", attackBase: 11, damage: "1d6", rof: 2, ammo: null, type: "melee" }
    ],
    cyberware: [], inventory: [{ item: "Medium Pistol Ammo", quantity: 24 }, { item: "Cheap Jacket", quantity: 1 }, { item: "Agent", quantity: 1 }]
  },
  {
    id: "rapinas_gunner", name: "Rapinas Gunner", faction: "Rapinas", role: "Vehicle Gunner", level: 2,
    stats: { INT: 5, REF: 7, DEX: 6, TECH: 4, COOL: 6, WILL: 5, LUCK: 3, MOVE: 6, BODY: 5, EMP: 4 },
    derived: { hp: 35, maxHp: 35, seriouslyWounded: 18, deathSave: 5 },
    armor: { head: { sp: 11 }, body: { sp: 11 } },
    skills: { Evasion: 6, Handgun: 6, Autofire: 8, "Shoulder Arms": 6, Brawling: 5, Athletics: 6, Perception: 6, Tactics: 5 },
    weapons: [
      { id: "smg", name: "SMG", skill: "Autofire", attackBase: 15, damage: "2d6", rof: 1, ammo: 40, type: "ranged" },
      { id: "heavy_pistol", name: "Heavy Pistol", skill: "Handgun", attackBase: 13, damage: "3d6", rof: 2, ammo: 8, type: "ranged" }
    ],
    cyberware: ["Cybereye"], inventory: [{ item: "SMG Ammo", quantity: 80 }, { item: "Heavy Pistol Ammo", quantity: 16 }, { item: "Radio", quantity: 1 }]
  },
  {
    id: "rapinas_enforcer", name: "Rapinas Enforcer", faction: "Rapinas", role: "Close Combat", level: 3,
    stats: { INT: 4, REF: 7, DEX: 7, TECH: 4, COOL: 6, WILL: 7, LUCK: 2, MOVE: 6, BODY: 7, EMP: 3 },
    derived: { hp: 45, maxHp: 45, seriouslyWounded: 23, deathSave: 7 },
    armor: { head: { sp: 11 }, body: { sp: 11 } },
    skills: { Evasion: 7, "Melee Weapon": 9, Brawling: 9, Handgun: 6, Athletics: 8, Stealth: 5, Perception: 5, Tactics: 5 },
    weapons: [
      { id: "heavy_melee", name: "Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 16, damage: "3d6", rof: 2, ammo: null, type: "melee" },
      { id: "heavy_pistol", name: "Heavy Pistol", skill: "Handgun", attackBase: 13, damage: "3d6", rof: 2, ammo: 8, type: "ranged" }
    ],
    cyberware: ["Cyberarm"], inventory: [{ item: "Heavy Pistol Ammo", quantity: 16 }, { item: "Knife", quantity: 1 }, { item: "Trauma Patch", quantity: 1 }]
  },
  {
    id: "rapinas_veteran", name: "Rapinas Veteran", faction: "Rapinas", role: "Veteran Fighter", level: 4,
    stats: { INT: 5, REF: 8, DEX: 7, TECH: 5, COOL: 7, WILL: 7, LUCK: 4, MOVE: 7, BODY: 7, EMP: 3 },
    derived: { hp: 45, maxHp: 45, seriouslyWounded: 23, deathSave: 7 },
    armor: { head: { sp: 13 }, body: { sp: 13 } },
    skills: { Evasion: 8, Autofire: 8, Handgun: 8, "Melee Weapon": 8, Brawling: 7, Athletics: 8, Perception: 7, Tactics: 7 },
    weapons: [
      { id: "smg", name: "SMG", skill: "Autofire", attackBase: 16, damage: "2d6", rof: 1, ammo: 40, type: "ranged" },
      { id: "heavy_melee", name: "Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 16, damage: "3d6", rof: 2, ammo: null, type: "melee" }
    ],
    cyberware: ["Cybereye", "Cyberarm"], inventory: [{ item: "SMG Ammo", quantity: 80 }, { item: "Trauma Patch", quantity: 2 }, { item: "Grenade", quantity: 1 }, { item: "Radio", quantity: 1 }]
  },
  {
    id: "rapinas_boss", name: "Rapinas Lieutenant", faction: "Rapinas", role: "Gang Lieutenant", level: 5,
    stats: { INT: 6, REF: 8, DEX: 8, TECH: 5, COOL: 8, WILL: 8, LUCK: 5, MOVE: 7, BODY: 8, EMP: 3 },
    derived: { hp: 50, maxHp: 50, seriouslyWounded: 25, deathSave: 8 },
    armor: { head: { sp: 13 }, body: { sp: 13 } },
    skills: { Evasion: 9, Autofire: 9, Handgun: 9, "Melee Weapon": 9, Brawling: 8, Athletics: 9, Perception: 8, Tactics: 9 },
    weapons: [
      { id: "assault_rifle", name: "Assault Rifle", skill: "Shoulder Arms", attackBase: 17, damage: "5d6", rof: 1, ammo: 25, type: "ranged" },
      { id: "very_heavy_melee", name: "Very Heavy Melee Weapon", skill: "Melee Weapon", attackBase: 17, damage: "4d6", rof: 1, ammo: null, type: "melee" }
    ],
    cyberware: ["Kerenzikov", "Cybereye", "Cyberarm", "Grafted Muscle and Bone Lace"], inventory: [{ item: "Assault Rifle Ammo", quantity: 50 }, { item: "Grenade", quantity: 2 }, { item: "Trauma Patch", quantity: 2 }, { item: "Agent", quantity: 1 }]
  },
];

/** Todos os 30 inimigos do catálogo, mapeados para o tipo Enemy. */
export const gmEnemyCatalog: Enemy[] = (catalogEnemies as unknown as Array<Parameters<typeof mapJsonToEnemy>[0]>).map(mapJsonToEnemy);

/** Dados brutos do catálogo para referência de facções. */
const catalogFactions: Record<string, string> = Object.fromEntries(
  catalogEnemies.map((e) => [e.id, e.faction])
);

/** Facções disponíveis no catálogo. */
export const availableFactions = [...new Set(catalogEnemies.map((e) => e.faction))];

/** Obtém a facção de um inimigo pelo ID. */
export function getEnemyFaction(id: string): string | undefined {
  return catalogFactions[id];
}

/** Filtra inimigos por facção usando o catálogo original. */
export function getEnemiesByFaction(faction: string): Enemy[] {
  const ids = catalogEnemies.filter((e) => e.faction === faction).map((e) => e.id);
  return gmEnemyCatalog.filter((e) => ids.includes(e.id));
}

/** Obtém um inimigo do catálogo pelo ID. */
export function getEnemyById(id: string): Enemy | undefined {
  return gmEnemyCatalog.find((e) => e.id === id);
}

/** Verifica se um inimigo existe no catálogo. */
export function isEnemyInCatalog(id: string): boolean {
  return gmEnemyCatalog.some((e) => e.id === id);
}

/** Retorna o número total de inimigos no catálogo. */
export function getCatalogSize(): number {
  return gmEnemyCatalog.length;
}