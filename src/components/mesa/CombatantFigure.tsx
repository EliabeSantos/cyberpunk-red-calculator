import type { CombatWeapon } from "@/lib/combat/contract";
import type { MesaCombatant } from "@/lib/mesa/types";

type FigureWeaponKind = "ranged" | "melee" | "thrown" | "staff" | "unarmed";

interface Props {
  combatant: Pick<MesaCombatant, "kind" | "name" | "isDead" | "conditions">;
  weapon?: CombatWeapon | null;
  visualWeaponKind?: "ranged" | "staff";
  animation?: "ranged" | "melee";
  active?: boolean;
  compact?: boolean;
}

function weaponKind(weapon: CombatWeapon | null | undefined): FigureWeaponKind {
  if (!weapon?.attackType) return weapon ? "ranged" : "unarmed";
  if (["melee", "martial_arts", "brawling", "unarmed"].includes(weapon.attackType)) return "melee";
  if (["thrown_weapon", "grenade"].includes(weapon.attackType)) return "thrown";
  return "ranged";
}

function WeaponLayer({ kind }: { kind: FigureWeaponKind }) {
  if (kind === "unarmed") return null;
  if (kind === "melee") {
    return (
      <g className="combatant-figure-weapon combatant-figure-weapon-melee" aria-hidden="true">
        <path d="M120 77 151 22" className="weapon-edge" />
        <path d="m116 86 13-8 8 8-12 11Z" className="weapon-hilt" />
        <path d="m108 94 18-18" className="weapon-grip" />
        <path d="m124 42 13 8" className="weapon-guard" />
      </g>
    );
  }
  if (kind === "staff") {
    return (
      <g className="combatant-figure-weapon combatant-figure-weapon-staff" aria-hidden="true">
        <path d="M126 111 153 18" className="weapon-staff-shaft" />
        <path d="M146 24c2-5 7-7 11-5" className="weapon-staff-cap" />
        <path d="M121 108h12" className="weapon-staff-grip" />
      </g>
    );
  }
  if (kind === "thrown") {
    return (
      <g className="combatant-figure-weapon combatant-figure-weapon-thrown" aria-hidden="true">
        <path d="M119 77 147 48" className="weapon-edge" />
        <path d="m138 38 15 10-15 10Z" className="weapon-hilt" />
        <circle cx="112" cy="84" r="11" className="weapon-core" />
        <path d="M112 72v24M100 84h24" className="weapon-detail" />
      </g>
    );
  }
  return (
    <g className="combatant-figure-weapon combatant-figure-weapon-ranged" aria-hidden="true">
      <path d="M108 76h34l10 7h-24l-8 9h-10l5-12Z" className="weapon-shell" />
      <path d="M141 76h18v5h-18Z" className="weapon-barrel" />
      <path d="m116 87 12 3-5 20-9-3Z" className="weapon-grip" />
      <path d="M119 78h18M133 84h9" className="weapon-detail" />
      <circle cx="125" cy="82" r="2" className="weapon-light" />
    </g>
  );
}

/** Corpo inteiro modular para a Mesa; a ficha continua sendo a fonte dos dados. */
export default function CombatantFigure({ combatant, weapon, visualWeaponKind, animation, active = false, compact = false }: Props) {
  const kind = weapon ? weaponKind(weapon) : visualWeaponKind ?? weaponKind(weapon);
  const enemy = combatant.kind === "enemy";
  const status = combatant.isDead ? "derrotado" : combatant.conditions.length > 0 ? "ferido" : "em prontidão";
  const label = `${combatant.name}, ${enemy ? "inimigo" : "personagem"}, ${status}${weapon ? `, equipamento ${weapon.name}` : visualWeaponKind === "ranged" ? ", arma de longo alcance" : visualWeaponKind === "staff" ? ", bastão" : ", desarmado"}`;

  return (
    <span
      className={`combatant-figure ${enemy ? "is-enemy" : "is-player"} ${active ? "is-active" : ""} ${combatant.isDead ? "is-dead" : ""} ${combatant.conditions.length > 0 ? "is-injured" : ""} ${compact ? "is-compact" : ""} ${animation ? `is-attacking-${animation}` : ""}`}
      data-weapon-kind={kind}
      aria-label={label}
      role="img"
    >
      <svg viewBox="0 0 176 224" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="figure-suit" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity=".95" />
            <stop offset=".55" stopColor="currentColor" stopOpacity=".58" />
            <stop offset="1" stopColor="#05090c" stopOpacity=".98" />
          </linearGradient>
          <linearGradient id="figure-face" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#f0c2a5" />
            <stop offset=".7" stopColor="#a96b62" />
            <stop offset="1" stopColor="#3a2730" />
          </linearGradient>
          <filter id="figure-shadow" x="-30%" y="-30%" width="160%" height="170%">
            <feDropShadow dx="0" dy="7" stdDeviation="5" floodColor="#000" floodOpacity=".65" />
          </filter>
        </defs>
        <ellipse cx="88" cy="211" rx="47" ry="7" className="combatant-figure-ground" />
        <g filter="url(#figure-shadow)" className="combatant-figure-body">
          <path d="M70 48c-7 7-10 19-7 29l-9 8 9 7 11-14 6 3v31l-17 37 7 48h15l5-43 5 43h16l5-49-17-36V81l8 12 13-8-13-28-15-10Z" fill="url(#figure-suit)" className="figure-torso" />
          <path d="M74 47c-2-15 5-27 17-27s20 11 17 26l-8 16-16 3-11-10Z" fill="url(#figure-face)" className="figure-head" />
          <path d="M73 43c1-18 10-26 22-24 9 1 15 8 16 19l-8-5-4 8-17 1-5 8Z" className="figure-hair" />
          <path d="m76 47 25-3" className="figure-visor" />
          <path d="M63 83 48 111l11 7 17-25M108 84l19 20-8 9-21-16" className="figure-arm" />
          <path d="m70 150-7 42h17l9-39M103 151l7 41h-17l-8-39" className="figure-leg" />
          <path d="M59 191h23l-4 8H54ZM94 191h17l10 8H94Z" className="figure-boot" />
          <path d="m68 94 35 1M75 119h28M68 141l36 1" className="figure-armor-detail" />
          <circle cx="91" cy="91" r="3" className="figure-core" />
          <WeaponLayer kind={kind} />
        </g>
      </svg>
    </span>
  );
}
