/**
 * astro-twig server entrypoint.
 *
 * Renders a `.twig` handle to HTML. Templates go into twig.js's own registry
 * under a flat id and WITHOUT a `path`, which is what makes
 * `{% include 'ns:name' %}` resolve by exact string match against the registry
 * instead of hitting the filesystem (twig.js `importFile`).
 */

import Twig from 'twig';

export const RENDERER_NAME = 'astro-twig';

/**
 * Marks a module as a Twig component. A symbol rather than a property so it
 * cannot collide with a template's own props.
 */
export const TWIG_COMPONENT = Symbol.for('astro-twig:component');

const registered = new Set();

let diskReads = 0;

// Nothing is allowed to fall through to disk: twig.js's fs loader is replaced
// by one that throws. If an include escapes the registry the build fails loudly
// rather than silently reading a file that will not exist once deployed.
Twig.extend((T) => {
  T.Templates.registerLoader('fs', (location, params) => {
    diskReads += 1;
    const target = (params && params.path) || location;
    throw new Error(`astro-twig: unexpected disk read for "${target}"`);
  });
});

/**
 * Compiles a template into the registry, once per id.
 */
export function registerTemplate(id, source) {
  if (registered.has(id)) {
    return;
  }
  registered.add(id);
  Twig.twig({
    id,
    data: source,
    // No `path`: keeps the id intact through importFile's parsePath branch,
    // so it stays an exact registry key.
    allowInlineIncludes: true,
    autoescape: false,
    rethrow: true,
  });
}

/**
 * Number of times a template lookup reached the filesystem loader. Should be
 * zero for the lifetime of a build; the tests assert it.
 */
export function diskReadCount() {
  return diskReads;
}

/**
 * Forgets a template so the next render recompiles it. Used by dev-server
 * reloading.
 */
export function evictTemplate(id) {
  registered.delete(id);
  Twig.extend((T) => {
    delete T.Templates.registry[id];
  });
}

function render(id, data) {
  return Twig.twig({ ref: id }).render(data);
}

export default {
  name: RENDERER_NAME,

  check: (Component) => Boolean(Component && Component[TWIG_COMPONENT]),

  async renderToStaticMarkup(Component, props, slots, metadata) {
    if (metadata && metadata.hydrate) {
      throw new Error(
        `astro-twig: Twig components cannot hydrate. Remove client:${metadata.hydrate} from <${Component.id}>.`,
      );
    }

    registerTemplate(Component.id, Component.source);

    // Slots arrive as already-rendered HTML strings, which is what a Twig
    // variable holding markup is. No conversion needed.
    return { html: render(Component.id, { ...props, ...slots }) };
  },

  // false: <astro-slot> markers exist so a client framework can find slots
  // during hydration. Twig never hydrates, and the markers would pollute the
  // markup.
  supportsAstroStaticSlot: false,
};
