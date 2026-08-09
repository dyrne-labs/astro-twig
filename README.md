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
| `id` | no | path relative to `components` | Derives a template's registry id from its absolute path. |

The id is what `{% include %}` matches on. With the default, a template at
`components/atoms/button.twig` is included as `{% include 'atoms/button.twig' %}`. Projects with
flat `namespace:name` ids pass their own `id` function; flat ids cost nothing to resolve because
they are used as registry keys verbatim.

## How it works

**Includes resolve from memory, never from disk.** Templates are registered with an `id` and no
`path`, which is what keeps the id an exact registry key through twig.js's `importFile`. The
filesystem loader is replaced by one that throws, so an include that escapes the registry fails the
build instead of quietly reading a file that will not exist once deployed.

**The include graph is the module graph.** `{% include %}`, `{% extends %}` and `{% embed %}`
targets are emitted as ESM imports of the included template's module. The bundler then orders
registration, inlines every template's source, and tree-shakes templates nothing imports. No glob
and no manifest.

That scan matches literal single-quoted targets. A dynamically named include still renders if
something else has already registered the target, but it will not pull the target in by itself.

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

Astro >= 5 and Vite >= 5 as peers. The renderer contract this builds on is byte-identical between
Astro 5.18 and 7.2.
