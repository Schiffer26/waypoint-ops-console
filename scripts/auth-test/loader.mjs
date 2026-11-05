export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') return { url: new URL('./electron-mock.mjs', import.meta.url).href, shortCircuit: true };
  if (specifier === './scheduler.js' && context.parentURL?.endsWith('/dist-electron/main.js')) return { url: new URL('./scheduler-mock.mjs', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
