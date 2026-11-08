/* Node loader hook: redirect three.js to the headless shim, but ONLY for
 * imports coming from the game code. The shim itself must reach the real
 * library, otherwise the redirect becomes circular. */

export async function resolve(specifier, context, nextResolve) {
  const fromGame = !String(context.parentURL || '').includes('/headless/');
  if (fromGame && specifier.includes('three.module.min.js')) {
    return { url: new URL('./three-shim.mjs', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
