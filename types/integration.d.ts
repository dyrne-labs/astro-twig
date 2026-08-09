export interface TwigIntegrationOptions {
  /** Directory holding the `.twig` files. */
  components: string | URL;
  /**
   * Derives a template's registry id from its absolute path. Defaults to the
   * path relative to `components`, forward-slashed, extension included.
   */
  id?: (file: string) => string;
}

export interface AstroIntegrationLike {
  name: string;
  hooks: Record<string, unknown>;
}

export default function twig(options: TwigIntegrationOptions): AstroIntegrationLike;
