export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const extension = specifier.endsWith(".json") ? "" : ".ts";
    return nextResolve(new URL(`../src/${specifier.slice(2)}${extension}`, import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}