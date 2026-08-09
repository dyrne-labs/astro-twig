export interface TwigIntegrationOptions {
  /** Directory holding the `.twig` files. */
  components: string | URL;
  /**
   * Extra roots, keyed by the prefix their templates are addressed under —
   * `{ '@atoms': '/abs/src/atoms' }` makes `{% include '@atoms/badge.twig' %}`
   * resolve.
   */
  namespaces?: Record<string, string | URL>;
  /**
   * Derives a template's registry id from its absolute path. Defaults to the
   * path relative to its root, forward-slashed, extension included, prefixed
   * by the namespace if it has one.
   */
  id?: (file: string) => string;
  /** Registered as Twig functions. */
  functions?: Record<string, (...args: never[]) => unknown>;
  /** Registered as Twig filters. */
  filters?: Record<string, (...args: never[]) => unknown>;
  /** Escape hatch, handed the Twig instance. */
  extensions?: (twig: unknown) => void;
  /**
   * Decides how named slots merge with props. Defaults to a filled slot
   * winning; return `{ ...slots, ...props }` for the opposite.
   */
  slots?: (props: Record<string, unknown>, slots: Record<string, string>) => Record<string, unknown>;
}

export interface AstroIntegrationLike {
  name: string;
  hooks: Record<string, unknown>;
}

export default function twig(options: TwigIntegrationOptions): AstroIntegrationLike;
