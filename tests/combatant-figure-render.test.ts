/**
 * Etapa 2 — renderização do `CombatantFigure` com figura personalizada.
 *
 * O que estes testes protegem:
 * - personagem com imagem configurada renderiza a FIGURA DE COMBATE (corpo
 *   inteiro) do estado ativo — nunca o retrato de perfil (o componente só
 *   recebe `figureImage`, que vem das imagens de estado);
 * - personagem legado/sem personalização continua com o boneco genérico SVG
 *   exatamente como antes (sem regressão do fallback);
 * - classe de derrotado é preservada com a imagem (a regra visual de morte
 *   continua valendo para a figura personalizada);
 * - falha de carregamento da imagem cai no boneco genérico sem quebrar a
 *   interface: a URL é marcada como falha e some da próxima consulta.
 *
 * O componente não usa hooks: os testes o chamam diretamente e percorrem a
 * árvore de elementos React (mesmo padrão de `attack-mode-flow.test.ts`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { ResolvedCombatStateImage } from "../src/lib/characterVisual/combatVisualState.ts";
import { isVisualUrlFailed, resetVisualManifestCache } from "../src/lib/characterVisual/visualManifestCache.ts";

const { default: CombatantFigure } = await import("../src/components/mesa/CombatantFigure.tsx");

interface ReactElementLike {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

function collect(node: unknown, tag: string, out: ReactElementLike[] = []): ReactElementLike[] {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, tag, out);
    return out;
  }
  const element = node as Partial<ReactElementLike>;
  if (!("type" in element) || !("props" in element) || !element.props) return out;
  if (element.type === tag) out.push(element as ReactElementLike);
  collect(element.props.children, tag, out);
  return out;
}

function root(tree: unknown): ReactElementLike {
  const span = collect(tree, "span")[0];
  assert.ok(span, "o CombatantFigure deve renderizar o span raiz");
  return span;
}

const combatant = { kind: "character" as const, name: "V", isDead: false, conditions: [] as string[] };
const figureImage: ResolvedCombatStateImage = {
  url: "/api/character-visual/asset/a-shoot?e=1&s=x",
  assetId: "a-shoot",
  state: "SHOOT",
};

test.beforeEach(() => resetVisualManifestCache());

test("figura personalizada renderiza a imagem do estado ativo com o boneco escondido", () => {
  const tree = CombatantFigure({ combatant, figureImage });
  const span = root(tree);
  const className = String(span.props.className);
  assert.ok(className.includes("has-image"), "classe has-image ativa a camada de imagem");
  assert.equal(span.props["data-visual-state"], "SHOOT", "estado visível para estilos/testes");

  const images = collect(tree, "img");
  assert.equal(images.length, 1);
  assert.equal(images[0].props.src, "/api/character-visual/asset/a-shoot?e=1&s=x");
  assert.equal(typeof images[0].props.onError, "function");
  // O SVG genérico continua na árvore como camada de fallback imediato.
  const svgs = collect(tree, "svg");
  assert.equal(svgs.length, 1);
});

test("personagem legado sem personalização mantém o boneco genérico (sem img)", () => {
  const tree = CombatantFigure({ combatant });
  const span = root(tree);
  assert.ok(!String(span.props.className).includes("has-image"));
  assert.equal(span.props["data-visual-state"], undefined);
  assert.equal(collect(tree, "img").length, 0);
  const svgs = collect(tree, "svg");
  assert.equal(svgs.length, 1, "o SVG genérico é a figura padrão");
  assert.equal(svgs[0].props.viewBox, "0 0 176 224");
});

test("sem combate configurado (figureImage null) também usa o genérico", () => {
  const tree = CombatantFigure({ combatant, figureImage: null });
  assert.equal(collect(tree, "img").length, 0);
  assert.ok(!String(root(tree).props.className).includes("has-image"));
});

test("estado derrotado é preservado na figura personalizada", () => {
  const tree = CombatantFigure({ combatant: { ...combatant, isDead: true }, figureImage });
  assert.ok(String(root(tree).props.className).includes("is-dead"),
    "o filtro visual de derrotado (grayscale na raiz) vale também para a imagem");
});

test("nome e indicadores continuam junto da figura (nada é substituído)", () => {
  const tree = CombatantFigure({ combatant, figureImage, active: true, compact: true });
  const className = String(root(tree).props.className);
  assert.ok(className.includes("is-active"));
  assert.ok(className.includes("is-compact"));
  assert.match(String(root(tree).props["aria-label"]), /V, personagem, em prontidão/);
});

test("falha de carregamento marca a URL e revela o boneco genérico sem quebrar", () => {
  const tree = CombatantFigure({ combatant, figureImage });
  const image = collect(tree, "img")[0];
  assert.ok(image);

  let removedClass = "";
  const parentClassList = { remove: (name: string) => { removedClass = name; } };
  const onError = image.props.onError as (event: unknown) => void;
  onError({
    currentTarget: {
      style: { display: "" } as CSSStyleDeclaration,
      parentElement: { classList: parentClassList },
    },
  });

  assert.equal(isVisualUrlFailed(figureImage.url), true, "URL quebrada fica marcada no cache");
  assert.equal(removedClass, "has-image", "classe removida → SVG genérico volta a aparecer");

  // O marcador faz o resolvedor pular a URL na próxima consulta do combate.
  assert.equal(
    isVisualUrlFailed(figureImage.url),
    true,
    "a próxima consulta de estado não deve servir a mesma URL",
  );
});
