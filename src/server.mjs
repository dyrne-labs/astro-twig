/**
 * astro-twig server entrypoint.
 *
 * Renders a `.twig` handle to HTML. Templates go into twig.js's own registry
 * under a flat id and WITHOUT a `path`, which is what makes
 * `{% include 'ns:name' %}` resolve by exact string match against the registry
 * instead of hitting the filesystem (twig.js `importFile`).
 *
 * The integration configures this module directly rather than through
 * serialised config, because functions and filters cannot be serialised.
 *
 * That means configuration and the renderer have to meet. They cannot rely on
 * being the same module instance: `ssr.external` holds during a build, but the
 * dev server inlines a linked package into its own module graph, so the copy
 * the integration imports and the copy Astro loads as the renderer are two
 * different modules. Anything kept in module scope diverges between them —
 * registration bookkeeping and the slot hook both did, which showed up as
 * twig.js refusing a duplicate template id and, more quietly, as an
 * unconfigured renderer.
 *
 * So the state lives on the `Twig` instance itself, which is shared because
 * twig.js is a plain dependency both copies resolve to the same file.
 */

import Twig from 'twig';

export const RENDERER_NAME = 'astro-twig';

/**
 * Marks a module as a Twig component. A symbol rather than a property so it
 * cannot collide with a template's own props.
 */
export const TWIG_COMPONENT = Symbol.for('astro-twig:component');

const STATE = Symbol.for('astro-twig:state');

/**
 * Default: a filled slot wins over a prop of the same name. Projects whose
 * templates treat an explicit prop as more specific pass their own.
 */
const defaultMergeSlots = (props, slots) => ({ ...props, ...slots });

/**
 * Shared across every copy of this module, because it hangs off Twig.
 */
function state() {
  if (!Twig[STATE]) {
    Twig[STATE] = {
      registered: new Set(),
      diskReads: 0,
      configured: false,
      mergeSlots: defaultMergeSlots,
    };

    // Nothing is allowed to fall through to disk: twig.js's fs loader is
    // replaced by one that throws. If an include escapes the registry the build
    // fails loudly rather than silently reading a file that will not exist once
    // deployed. Registered once, with the state, so a second copy of this
    // module does not stack another loader on top.
    Twig.extend((T) => {
      T.Templates.registerLoader('fs', (location, params) => {
        Twig[STATE].diskReads += 1;
        const target = (params && params.path) || location;
        throw new Error(`astro-twig: unexpected disk read for "${target}"`);
      });
    });
  }

  return Twig[STATE];
}

/**
 * Applies project-specific configuration to the shared twig.js instance.
 * Called by the integration at config time, before any render.
 */
export function configure({ functions, filters, extensions, slots } = {}) {
  const shared = state();
  shared.configured = true;

  for (const [name, fn] of Object.entries(functions || {})) {
    Twig.extendFunction(name, fn);
  }
  for (const [name, fn] of Object.entries(filters || {})) {
    Twig.extendFilter(name, fn);
  }
  if (extensions) {
    extensions(Twig);
  }
  if (slots) {
    shared.mergeSlots = slots;
  }
}

/**
 * True once the integration has configured the renderer.
 */
export function isConfigured() {
  return state().configured;
}

/**
 * Compiles a template into the registry, once per id.
 */
export function registerTemplate(id, source) {
  const { registered } = state();

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
    // renderToStaticMarkup has to hand back a string, and twig.js defaults to
    // async mode, where render() can settle later. None of the templates this
    // has been run against need it — the suite passes either way — but a
    // template that did would produce "[object Promise]" in the output rather
    // than an error, so the default is not worth keeping.
    async: false,
  });
}

/**
 * Number of times a template lookup reached the filesystem loader. Should be
 * zero for the lifetime of a build; the tests assert it.
 */
export function diskReadCount() {
  return state().diskReads;
}

/**
 * Forgets a template so the next render recompiles it. Used by dev-server
 * reloading.
 */
export function evictTemplate(id) {
  state().registered.delete(id);
  Twig.extend((T) => {
    delete T.Templates.registry[id];
  });
}

/**
 * Test seam: drops all configuration and registrations.
 */
export function reset() {
  const shared = state();
  shared.configured = false;
  shared.mergeSlots = defaultMergeSlots;
  for (const id of [...shared.registered]) {
    evictTemplate(id);
  }
}

function render(id, data) {
  return Twig.twig({ ref: id }).render(data);
}

/**
 * Astro types slots as `Record<string, string>`, but at runtime the values are
 * objects that stringify to their HTML. Twig cannot tell the difference until
 * something iterates one — `{% for x in slot %}` then walks the object's own
 * keys instead of the markup, and hands a null into whatever comes next. The
 * failure surfaces inside a twig.js filter, nowhere near the slot.
 *
 * Coercing here makes the runtime match the declared type.
 */
function asStrings(slots) {
  const out = {};
  for (const [name, value] of Object.entries(slots || {})) {
    out[name] = value === null || value === undefined ? value : String(value);
  }
  return out;
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
    try {
      return { html: render(Component.id, state().mergeSlots(props, asStrings(slots))) };
    } catch (error) {
      // twig.js reports failures from inside its own filters, with no hint of
      // which template was rendering. Without this, a build error points at
      // node_modules and nothing else.
      error.message = `astro-twig: rendering "${Component.id}" failed. ${error.message}`;
      throw error;
    }
  },

  // false: <astro-slot> markers exist so a client framework can find slots
  // during hydration. Twig never hydrates, and the markers would pollute the
  // markup.
  supportsAstroStaticSlot: false,
};
