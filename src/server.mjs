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
 * The state therefore lives on `globalThis`, and what `configure()` was given
 * is kept alongside it. Both halves are needed, because a copied module brings
 * a copied `Twig` with it:
 *
 * - shared state means every copy agrees on what has been registered, what the
 *   slot hook is, and how many disk reads happened;
 * - the recorded configuration means a copy handed a *different* `Twig` can
 *   replay the functions and filters onto it, rather than rendering against an
 *   instance nothing ever extended.
 *
 * Hanging the state off `Twig`, as this did, holds only while twig.js resolves
 * to one file. Astro 7 renders static pages in a `prerender` environment that
 * inlines it, so the renderer got a second `Twig` with none of the host's
 * functions on it — a build failure naming the template rather than the cause.
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
 * Shared across every copy of this module, because it hangs off globalThis.
 *
 * `extended` tracks which `Twig` instances have had the configuration applied.
 * A WeakSet rather than a flag: "has this been configured" is a question about
 * a particular instance, and with a bundler in play there can be more than one.
 */
function state() {
  if (!globalThis[STATE]) {
    globalThis[STATE] = {
      // Per `Twig` instance, because the compiled-template registry is. Shared
      // bookkeeping would have a second copy skip the compile as already done
      // and then fail to find the template in its own registry.
      registrations: new WeakMap(),
      diskReads: 0,
      configured: false,
      options: null,
      extended: new WeakSet(),
      mergeSlots: defaultMergeSlots,
    };
  }

  return globalThis[STATE];
}

/**
 * The ids compiled into one `Twig` instance's registry.
 */
function registeredIn(twig) {
  const { registrations } = state();
  if (!registrations.has(twig)) {
    registrations.set(twig, new Set());
  }
  return registrations.get(twig);
}

/**
 * Applies the configuration to a `Twig` instance, once each.
 *
 * Called by `configure()` for the instance it can see, and again before a
 * render for whichever instance is doing the rendering. Those are usually the
 * same object and the second call does nothing; when the bundler has made a
 * copy, this is what stops that copy rendering against an unextended Twig.
 */
function extend(twig) {
  const shared = state();

  if (shared.extended.has(twig)) {
    return;
  }
  shared.extended.add(twig);

  // Nothing is allowed to fall through to disk: twig.js's fs loader is replaced
  // by one that throws. If an include escapes the registry the build fails
  // loudly rather than silently reading a file that will not exist once
  // deployed. Per instance, because a second Twig brings its own loader table.
  twig.extend((T) => {
    T.Templates.registerLoader('fs', (location, params) => {
      state().diskReads += 1;
      const target = (params && params.path) || location;
      throw new Error(`astro-twig: unexpected disk read for "${target}"`);
    });
  });

  const { functions, filters, extensions } = shared.options || {};

  for (const [name, fn] of Object.entries(functions || {})) {
    twig.extendFunction(name, fn);
  }
  for (const [name, fn] of Object.entries(filters || {})) {
    twig.extendFilter(name, fn);
  }
  if (extensions) {
    extensions(twig);
  }
}

/**
 * Applies project-specific configuration to the shared twig.js instance.
 * Called by the integration at config time, before any render.
 *
 * The options are kept, not just applied: a copy of this module that never sees
 * this call still has to be able to extend the Twig it was bundled with.
 */
export function configure({ functions, filters, extensions, slots } = {}) {
  const shared = state();
  shared.configured = true;
  shared.options = { functions, filters, extensions };

  // A re-configure has new functions to apply, so no instance counts as done.
  shared.extended = new WeakSet();
  extend(Twig);

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
  // Before the first compile, not only before the first render: a template
  // whose own source calls a registered function has to find it here too.
  extend(Twig);

  const registered = registeredIn(Twig);

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
  registeredIn(Twig).delete(id);
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
  shared.options = null;
  shared.extended = new WeakSet();
  shared.mergeSlots = defaultMergeSlots;
  for (const id of [...registeredIn(Twig)]) {
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

    // Registers into this instance's registry, and extends this instance —
    // which is the copy actually rendering, whatever the bundler did.
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
