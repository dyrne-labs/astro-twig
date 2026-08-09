/**
 * Fallback declaration so any `.twig` import compiles, untyped.
 *
 * A project generating per-template declarations from its own schemas should
 * emit them with EXACT module names — `declare module '@ct/button.twig'` — not
 * wildcards. An exact name beats this catch-all. A wildcard with an empty
 * prefix (`'*\/button.twig'`) does not: it ties with `'*.twig'`, this
 * declaration wins, and every prop check silently disappears while type
 * checking still reports success.
 */
declare module '*.twig' {
  const Component: (props: Record<string, unknown>) => unknown;
  export default Component;
}
