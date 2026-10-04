import type { SVGProps } from "react";

/**
 * Ícones do sistema: traço único, cantos retos (mesma linguagem dos filetes de
 * 1px da interface) e cor herdada via `currentColor`.
 *
 * Todos são decorativos — sempre aparecem ao lado de um rótulo de texto, por
 * isso `aria-hidden` e `focusable="false"` saem de fábrica.
 */
function PanelIcon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Alvo concêntrico — roster de inimigos. */
export function TargetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <PanelIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.75" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </PanelIcon>
  );
}

/** Sinal de adição — criar inimigo. */
export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <PanelIcon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </PanelIcon>
  );
}

/** Espadas cruzadas — combate. */
export function SwordsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <PanelIcon {...props}>
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
      <path d="M13 19l6-6" />
      <path d="M16 16l4 4" />
      <path d="M19 21l2-2" />
      <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
      <path d="M5 14l4 4" />
      <path d="M7 17l-3 3" />
      <path d="M3 19l2 2" />
    </PanelIcon>
  );
}

/** Seta para a esquerda — voltar. */
export function ArrowLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <PanelIcon {...props}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </PanelIcon>
  );
}

/** Sinal de avanço — item que abre um sub-painel. */
export function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <PanelIcon {...props}>
      <path d="m9 18 6-6-6-6" />
    </PanelIcon>
  );
}

/** Fechar. */
export function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <PanelIcon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </PanelIcon>
  );
}

/** Duas pessoas — roster de participantes. */
export function UsersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <PanelIcon {...props}>
      <path d="M15 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 3 18.5V20" />
      <circle cx="9" cy="8" r="3.25" />
      <path d="M16 4.6a3.25 3.25 0 0 1 0 6.3" />
      <path d="M21 20v-1.5a3.5 3.5 0 0 0-2.6-3.38" />
    </PanelIcon>
  );
}

/** Giro horário — gerar outro / atualizar. */
export function RotateCwIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <PanelIcon {...props}>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.49-6.01" />
      <polyline points="20.5 4.5 20.5 9 16 9" />
    </PanelIcon>
  );
}

/** Play — carregar encontro salvo. */
export function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <PanelIcon {...props}>
      <polygon points="6.5 4 19 12 6.5 20" fill="currentColor" stroke="none" />
    </PanelIcon>
  );
}

/** Lixeira — excluir. */
export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <PanelIcon {...props}>
      <path d="M3.5 6h17" />
      <path d="M9 6V3.5h6V6" />
      <path d="M18.5 6l-1 14.5h-11L5.5 6" />
      <path d="M10 10v6.5M14 10v6.5" />
    </PanelIcon>
  );
}

/** Lista — conjuntos (encontros salvos). */
export function ListIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <PanelIcon {...props}>
      <path d="M8.5 6h12M8.5 12h12M8.5 18h12" />
      <path d="M3.75 6h.01M3.75 12h.01M3.75 18h.01" />
    </PanelIcon>
  );
}

/** Disquete — salvar. */
export function SaveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <PanelIcon {...props}>
      <path d="M4 4h13l3 3v13H4z" />
      <path d="M8 4v5h7V4" />
      <path d="M8 20v-6h8v6" />
    </PanelIcon>
  );
}

/** Relógio — histórico. */
export function ClockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <PanelIcon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <polyline points="12 7 12 12 15.5 14" />
    </PanelIcon>
  );
}

/** Transmissão — mesa online. */
export function RadioIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <PanelIcon {...props}>
      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
      <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
    </PanelIcon>
  );
}
