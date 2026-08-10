# astro-twig

Renders Twig templates as Astro components, at build time. `.twig` files become importable
components with props, slots and includes; nothing Twig-related reaches the browser.

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import twig from 'astro-twig';

export default defineConfig({
  integrations: [
    twig({ components: new URL('./src/components', import.meta.url) }),
  ],
});
```

```astro
---
import Button from '../components/button.twig';
---
<Button theme="light" text="Go">
  <Fragment slot="content_bottom"><em>anything</em></Fragment>
</Button>
```

A runnable proof is in [`examples/basic`](examples/basic): `npm install && npm run build`.

## Options

| Option | Required | Default | |
|---|---|---|---|
| `components` | yes | — | Directory holding the `.twig` files. String or `URL`. |
| `namespaces` | no | `{}` | Extra roots, keyed by the prefix their templates are addressed under. |
| `id` | no | path relative to its root | Derives a template's registry id from its absolute path. |
| `functions` | no | `{}` | Registered as Twig functions. |
| `filters` | no | `{}` | Registered as Twig filters. |
| `extensions` | no | — | Escape hatch, handed the `Twig` instance. |
| `slots` | no | slots win | Decides how named slots merge with props. |

```js
twig({
  components: new URL('./src/components', import.meta.url),
  namespaces: { '@atoms': new URL('./src/atoms', import.meta.url) },
  functions: { shout: (v) => String(v).toUpperCase() },
  filters: { exclaim: (v) => `${v}!` },
  extensions: (Twig) => Twig.extendFunction('t', translate),
  slots: (props, slots) => ({ ...slots, ...props }),
});
```

The id is what `{% include %}` matches on. With the default, a template at
`components/atoms/button.twig` is included as `{% include 'atoms/button.twig' %}`, and one under the
`@atoms` namespace as `{% include '@atoms/button.twig' %}`. Projects with flat `namespace:name` ids
pass their own `id` function; flat ids cost nothing to resolve because they are used as registry
keys verbatim.

`slots` exists because projects disagree about precedence. The default lets a filled slot override a
prop of the same name; return `{ ...slots, ...props }` for the opposite. It receives the full set of
props and slots and returns the template's data, so it doubles as the place to project or convert
values on their way in.

Slot values are coerced to strings before the hook sees them. Astro types them as strings but passes
objects that stringify, and Twig cannot tell the difference until a template iterates one.

Functions and filters are passed as live values rather than serialised config, which means the
package marks itself `ssr.external` so the renderer stays a single module instance. `isConfigured()`
reports whether that held.

## How it works

**Includes resolve from memory, never from disk.** Templates are registered with an `id` and no
`path`, which is what keeps the id an exact registry key through twig.js's `importFile`. The
filesystem loader is replaced by one that throws, so an include that escapes the registry fails the
build instead of quietly reading a file that will not exist once deployed.

**The include graph is the module graph.** `{% include %}`, `{% extends %}` and `{% embed %}`
targets are emitted as ESM imports of the included template's module. The bundler then orders
registration, inlines every template's source, and tree-shakes templates nothing imports. No glob
and no manifest.

That scan matches literal single-quoted targets in `include`, `extends`, `embed`, `import`, `from`
and `use`. A dynamically named include still renders if something else has already registered the
target, but it will not pull the target in by itself. `{% import _self %}` names no file and is
correctly ignored.

## Dev server

Editing a template updates the page, and so does editing a template it includes.

Two things make that work, and both are needed. The compiled template is cached in twig.js's
registry under its id, so it is evicted on change — otherwise the module re-transforms with the new
source, re-registers, and the old markup renders anyway. And the template index is rebuilt, so an
edit that adds an `{% include %}` of a file that was not in the graph before still resolves.

## No hydration

`client:load` and friends throw at build time. This is deliberate and it has to be explicit: Astro
does **not** error on a renderer with no `clientEntrypoint`. It emits an inert `<astro-island>`,
omits the hydration payload, and continues — so the component renders, nothing hydrates, and
nothing warns. The renderer refuses instead.

For interactivity, use a plain `<script>` alongside the template.

## Types

`astro-twig/types` declares a catch-all so any `.twig` import compiles:

```ts
/// <reference types="astro-twig/types" />
```

To type props per template, add **exact** module declarations behind a path alias — see
[`examples/basic/src/twig.d.ts`](examples/basic/src/twig.d.ts). Projects with component schemas
generate these.

> **Do not write per-template types as wildcards.** `declare module '*/button.twig'` has an empty
> prefix, so it ties with the catch-all `'*.twig'`, the catch-all wins, and every prop check
> silently stops applying — while type checking still reports success. Exact names, or a prefix that
> is not empty.
>
> Verify with a negative control: add a page setting an invalid enum, a typo'd prop, a missing
> required prop and a wrong type, and confirm you get four errors rather than none. Worth wiring
> into CI wherever these declarations are generated.

## Requirements

Astro >= 5 and Vite >= 5 as peers. The renderer contract this builds on is byte-identical across
Astro 5.18, 6.4 and 7.2 — the equivalence gate renders 156 components on each and finds no
difference, whitespace included.

Astro 7 needs one thing of a renderer that 5 did not. It builds static pages in a `prerender`
environment which inlines dependencies rather than externalising them, so the copy of twig.js
doing the rendering is not necessarily the copy the integration configured. `server.mjs` handles
that by keeping its state on `globalThis` and replaying the configuration onto whichever instance
it finds; nothing is required of the host.
