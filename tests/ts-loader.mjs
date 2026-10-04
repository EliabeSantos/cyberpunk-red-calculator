export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const extension = specifier.endsWith(".json") ? "" : ".ts";
    return nextResolve(new URL(`../src/${specifier.slice(2)}${extension}`, import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}

/**
 * Transpila `.tsx` para JS.
 *
 * O Node só REMOVE tipos (`--experimental-strip-types`); ele não transforma
 * JSX e recusa a extensão `.tsx` no carregamento padrão. Sem este hook nenhum
 * teste consegue importar um componente React, então o fluxo da UI (seletor de
 * Attack Mode, handlers) ficaria fora da suíte.
 *
 * O `typescript` é importado só quando há `.tsx` na lista, para não pesar na
 * abertura dos testes puramente de `src/lib`.
 */
export async function load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);

  const { readFileSync } = await import("node:fs");
  const { default: ts } = await import("typescript");
  const source = readFileSync(new URL(url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: new URL(url).pathname,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
