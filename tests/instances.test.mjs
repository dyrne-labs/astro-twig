/**
 * The renderer must work when two copies of this module exist.
 *
 * That is not hypothetical. `ssr.external` keeps it to one copy during a build,
 * but a dev server inlines a linked package into its own module graph, so the
 * copy an integration calls `configure()` on and the copy Astro loads as the
 * renderer are different modules.
 *
 * State in module scope diverges between them. That showed up as twig.js
 * refusing a duplicate template id, and — quieter, and worse — as a renderer
 * with none of the host's functions or slot handling. So the state lives on
 * `globalThis`, which no bundler can fork.
 *
 * A copied module can also bring a copied `Twig`, which is what Astro 7's
 * `prerender` environment does. Sharing the state is not enough there — the
 * second `Twig` has none of the host's functions on it — so `configure()`
 * records what it was given and every copy replays it onto whatever instance
 * it resolved. That half cannot be tested here: `server.mjs` imports `twig` by
 * bare specifier, so every copy loaded in-process gets the same one and there
 * is no seam to inject a second. What covers it is a host package's own gate,
 * where a real bundler builds a real site.
 *
 * Without this test the invariant is only exercised indirectly, by a dev test
 * in another package that would fail with an error about stylesheets.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Twig from 'twig';

const MODULE = new URL('../src/server.mjs', import.meta.url).href;

/**
 * A distinct module instance. Node keys the ESM cache by full URL, so a query
 * string is enough to get a second copy of the same file — which is what a
 * bundler ends up doing by a different route.
 */
function loadCopy(tag) {
  return import(`${MODULE}?instance=${tag}`);
}

test('configuration through one copy reaches a render through another', async () => {
  const configuring = await loadCopy('configure');
  const rendering = await loadCopy('render');

  assert.notEqual(configuring.default, rendering.default, 'expected two distinct module instances');

  configuring.configure({
    functions: { shout: (value) => String(value).toUpperCase() },
    slots: (props, slots) => ({ ...slots, ...props }),
  });

  // The host configured one copy; Astro renders through the other.
  assert.equal(rendering.isConfigured(), true);

  const handle = { id: 'two-instances.twig', source: '<p>{{ shout(word) }}|{{ collision }}</p>' };
  handle[rendering.TWIG_COMPONENT] = true;

  const { html } = await rendering.default.renderToStaticMarkup(
    handle,
    { word: 'loud', collision: 'prop wins' },
    { collision: 'slot loses' },
  );

  // The function came from the other copy's configure().
  assert.match(html, /LOUD/);
  // So did the slot rule, which is inverted from the default.
  assert.match(html, /prop wins/);
});

test('what configure() was given is kept, so a later copy can replay it', async () => {
  const configuring = await loadCopy('records');

  const shout = (value) => String(value).toUpperCase();
  configuring.configure({ functions: { shout } });

  // The bundled case cannot be reproduced in-process — every copy imports
  // `twig` by bare specifier and gets the same instance — so this asserts on
  // what makes that case survivable: the options are still there to apply to a
  // Twig that has never seen them. Astro 7's prerender environment inlines
  // twig.js, and without this every template calling a host-registered
  // function fails with "<name> function does not exist".
  const recorded = globalThis[Symbol.for('astro-twig:state')].options;

  assert.equal(recorded.functions.shout, shout);
  assert.equal(globalThis[Symbol.for('astro-twig:state')].extended.has(Twig), true);
});

test('registering the same template through both copies does not throw', async () => {
  const first = await loadCopy('register-a');
  const second = await loadCopy('register-b');

  const source = '<p>once</p>';

  first.registerTemplate('shared-id.twig', source);
  // twig.js refuses a duplicate id, and both copies resolve the same `Twig` —
  // so the second call has to see the first's registration. The bookkeeping is
  // keyed by instance rather than shared outright, because a copy that resolved
  // a *different* Twig has an empty registry and must compile into it.
  second.registerTemplate('shared-id.twig', source);

  const handle = { id: 'shared-id.twig', source };
  handle[second.TWIG_COMPONENT] = true;

  const { html } = await second.default.renderToStaticMarkup(handle, {}, {});
  assert.equal(html, '<p>once</p>');
});
