/// <reference types="astro-twig/types" />

/**
 * The catch-all above keeps any `.twig` import compiling, untyped.
 *
 * Per-template types go below it as EXACT module names, reached through the
 * `@ct/*` alias in tsconfig.json. In a project with schemas these are
 * generated; here they are written out to show the arrangement.
 *
 * Exact beats wildcard, so these win over the catch-all. Do not be tempted to
 * write them as `declare module '*\/button.twig'` — a wildcard with an empty
 * prefix ties with `'*.twig'`, the catch-all wins, and every check below
 * silently stops applying while `astro check` still reports success.
 */

declare module '@ct/button.twig' {
  const Component: (props: {
    theme: 'light' | 'dark';
    size?: 'large' | 'regular';
    text?: string;
    url?: string;
  }) => unknown;
  export default Component;
}

declare module '@ct/link.twig' {
  const Component: (props: {
    url: string;
    text?: string;
    theme?: 'light' | 'dark';
  }) => unknown;
  export default Component;
}
