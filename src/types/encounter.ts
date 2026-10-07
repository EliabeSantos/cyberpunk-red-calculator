/**
 * Formas do ENCONTRO (GM) — as mesmas que o `gmStorage` sempre definiu,
 * movidas para cá no F1.2 para que as regras de combate pudessem ser
 * extraídas sem importar `gmStorage` (módulo `client-only`).
 *
 * Este arquivo é só tipagem: nenhuma dependência de DOM, `localStorage`,
 * Supabase ou React. `gmStorage.ts` re-exporta os três tipos de volta
 * (`export type ... from "@/types/encounter"`), então nenhum consumidor
 * existente precisou mudar.
 */
import type { AttackModifier } from "@/types/attack";
import type { EnemySupply } from "@/types/enemy";
import type { EnemyAttributeName } from "@/types/enemy";
import type { PersonalityTrait } from "@/data/personalityTraits";
import type { CriticalInjury } from "@/data/criticalInjuries";

export interface EncounterParticipant {
  enemyId: string;
  /**
   * Identidade ESTÁVEL deste inimigo dentro do encontro — é o que vira
   * `source_key` na mesa (`mesa_combatants`), para o HP aplicado aqui chegar
   * à linha certa lá. Opcional só nas fichas salvas antes desta feature:
   * `ensureEncounterIds` completa na carga.
   */
  id?: string;
  name: string;
  archetype: string;
  faction: string;
  level: number;
  threatLevel: string;
  hp: { current: number; max: number };
  armor: { head: number; body: number };
  conditions: Array<{ id: string; name: string }>;
  /** Lesões persistentes do inimigo, compartilhando o mesmo modelo do Player. */
  criticalInjuries?: CriticalInjury[];
  isPlayer: boolean; // false = enemy/NPC
  // Weapon info
  weaponName: string;
  /** Identidade estável da arma no catálogo do inimigo. */
  weaponId?: string;
  /** Granularidade disponível no catálogo de inimigos. */
  weaponAttackType?: "melee" | "ranged" | "thrown";
  weaponRateOfFire?: number;
  requiresTwoHands?: boolean;
  weaponSkillId: string;
  weaponSkillName: string;
  refStat: number;
  /** STAT DEX do inimigo, congelado ao materializar o encontro. */
  dexStat?: number;
  /** STAT MOVE do inimigo — alimenta o orçamento MOVE × 2 da mesa online. */
  moveStat?: number;
  skillValue: number;
  attackBase: number;
  /**
   * Nível da perícia **Evasion** do inimigo — a base do teste é REF + nível
   * (`REF` mora em `refStat`, ver `getEvasionBase`). Sorteado no nascimento do
   * participante porque é o que o botão 💨 Evasão do cartão precisa mostrar.
   * Opcional nas fichas salvas antes desta feature (mesmo molde de `moveStat`).
   */
  evasionSkillLevel?: number;
  /** STAT canônico da perícia Evasion no bestiário. */
  evasionSkillStat?: EnemyAttributeName;
  /** Nome da perícia como está no bestiário ("Evasion") — só para exibição. */
  evasionSkillName?: string;
  damageExpression: string;
  // Last roll results
  /**
   * Último ataque. `modifiers` carrega o bônus dos implantes que entrou no
   * total (ausente nas fichas salvas antigas) — é ele que o cartão mostra.
   */
  lastAttackRoll: {
    diceRolls: number[];
    diceTotal: number;
    total: number;
    critical: boolean;
    fumble: boolean;
    modifiers?: AttackModifier[];
  } | null;
  /** `expression` é a usada na rolagem (com dados extras de implante, ex.: `1d6+1d6`). */
  lastDamageRoll: { rolls: number[]; total: number; expression?: string } | null;
  /**
   * Última rolagem de Evasão do cartão. `undefined` nas fichas salvas antes
   * desta feature — a UI trata com `!= null`, igual às demais rolagens.
   */
  lastEvasionRoll?: {
    diceRolls: number[];
    diceTotal: number;
    total: number;
    critical: boolean;
    fumble: boolean;
    modifiers?: AttackModifier[];
  } | null;
  initiative: number | null;
  // Personality traits for roleplay
  personalityTraits: PersonalityTrait[];
  /**
   * Implantes (cyberware) deste inimigo — sorteados na criação do encontro,
   * quanto maior o nível, mais implantes (`getEnemyImplants`). Contam nos
   * dados que ele rola (ataque, Evasão, Iniciativa, dano desarmado) e no SP do
   * corpo, exatamente como na ficha do jogador (`src/lib/enemyCyberware.ts`).
   * Opcional nas fichas salvas antes desta feature.
   */
  implants?: string[];
  /**
   * Capacidade do pente e balas no pente AGORA — só em arma à distância do
   * bestiário (corpo a corpo fica sem os dois). Ausente nas fichas salvas
   * antes desta feature: a UI trata com `!= null` como nas demais rolagens.
   */
  magazine?: number;
  ammo?: number;
  /**
   * Mochila do inimigo no encontro: munição da reserva e itens de cura.
   * Montada na criação (`getEnemySupplies`), que garante 2 cargas e sorteia
   * cura; ausente nas fichas salvas antes desta feature.
   */
  inventory?: EnemySupply[];
}

/**
 * Vínculo do encontro com uma PARTIDA da mesa — é o que torna o encontro de
 * uso único: lançado uma vez, ele nunca mais inicia combate (decisão de
 * 27/09/2026). Guardado junto do encontro no localStorage porque é o
 * encontro que "sabe" que já foi usado; o servidor tem a palavra final
 * (`mesa_battles.encounter_id` é UNIQUE).
 */
export interface EncounterBattle {
  sessionId: string;
  /** Código da mesa, para o aviso "em combate na Mesa XXXXX" sobreviver. */
  joinCode: string;
  status: "active" | "completed";
  startedAt: string;
  /** Só quando a partida é fechada (GM encerra, sessão encerra ou fim automático). */
  completedAt?: string;
}

export interface EncounterData {
  id: string;
  name: string;
  faction: string;
  enemyCount: number;
  participants: EncounterParticipant[];
  createdAt: string;
  /** Presente desde que este encontro tenha lançado um combate online. */
  battle?: EncounterBattle;
}

/**
 * Recorte que as regras de **implantes/cyberware** do participante leem
 * (`getParticipant*Modifiers`, dano desarmado). O alias morava no `gmStorage`
 * e veio junto na extração do F1.2 para não virar uma segunda versão em
 * cada módulo novo.
 */
export type ImplantBearer = Pick<EncounterParticipant, "implants">;
