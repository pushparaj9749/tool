/* Node loader hook: redirect three.js to the headless shim.
 *
 * Only imports that originate from src/ (the game code) are redirected.
 * The shim itself and the vendored postprocessing add-ons must reach the real
 * library, otherwise the add-ons would be served the shim and fail on the
 * exports the shim does not re-export.
 */

export async function resolve(specifier, context, nextResolve) {
  const parent = String(context.parentURL || '');
  const fromSrc = parent.includes('/src/') || parent.includes('/tests/headless/boot');
  if (fromSrc && specifier.includes('three.module.min.js')) {
    return { url: new URL('./three-shim.mjs', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
