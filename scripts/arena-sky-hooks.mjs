// ---------------------------------------------------------------------------
// Hooks de resolución para cargar el fondo en node (scripts/arena-sky.mjs)
// ---------------------------------------------------------------------------
//
// Node, con `--experimental-strip-types`, carga TS pero no resuelve los
// imports relativos SIN extensión (`./arena-look`), que es como los escribe
// todo `src/` (el tsconfig no admite `.ts` en los imports). Este hook
// prueba `<especificador>.ts` cuando el importador es un .ts y el
// especificador es relativo y sin extensión. Nada más: los paquetes
// (`three`, `three/addons/...`) siguen su camino normal.
// ---------------------------------------------------------------------------

export async function resolve(specifier, context, next) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  const fromTs = context.parentURL?.endsWith('.ts');
  const hasExt = /\.[cm]?[jt]s$|\.json$/.test(specifier);
  if (relative && fromTs && !hasExt) {
    try {
      return await next(`${specifier}.ts`, context);
    } catch {
      // cae al resolutor normal (y a su error, que dice qué falta)
    }
  }
  return next(specifier, context);
}
