/**
 * astro-twig — a Twig renderer for Astro.
 *
 * Knows nothing about any particular design system. It turns `.twig` imports
 * into Astro components; anything project-specific arrives through options.
 *
 * The move that makes it work: `{% include 'target' %}` is emitted as an ESM
 * import of the included template's module. The Twig include graph becomes the
 * module graph, so the bundler guarantees dependencies are registered before
 * dependents, inlines every template's source at build time, and tree-shakes
 * templates nothing imports.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configure, evictTemplate } from './server.mjs';

const RENDERER = 'astro-twig';

/**
 * Bare specifiers, so `ssr.external` applies to them. That is what keeps the
 * renderer a single module instance shared with this file — see server.mjs.
 */
const SERVER = 'astro-twig/server';

const INCLUDE_RE = /\{%-?\s*(?:include|extends|embed|import|from|use)\s+'([^']+)'/g;

/**
 * Vite module ids use forward slashes on every platform.
 */
function toModuleId(absolutePath) {
  return absolutePath.split(path.sep).join('/');
}

function toPath(value) {
  if (value instanceof URL) {
    return fileURLToPath(value);
  }
  if (typeof value === 'string' && value.startsWith('file://')) {
    return fileURLToPath(new URL(value));
  }
  return value;
}

/**
 * Every template target named in a source, in order. Matches literal
 * single-quoted targets only; a dynamically named include still renders if the
 * target is registered by something else, but cannot be discovered here.
 */
export function includeTargets(source) {
  return [...source.matchAll(INCLUDE_RE)].map((match) => match[1]);
}

/**
 * Resolves the roots a template can live under: the components directory,
 * plus any namespaced directories. Longest path first, so a namespace nested
 * inside the components directory wins over the components directory itself.
 */
function resolveRoots(componentsDir, namespaces) {
  const roots = [{ prefix: '', dir: componentsDir }];

  for (const [prefix, dir] of Object.entries(namespaces || {})) {
    roots.push({ prefix, dir: path.resolve(toPath(dir)) });
  }

  return roots.sort((a, b) => b.dir.length - a.dir.length);
}

/**
 * Default registry id: the template's path relative to its root, extension
 * included, prefixed by the namespace if it has one. So `atoms/button.twig`,
 * or `@atoms/button.twig` under a namespace.
 *
 * Projects using flat ids — a `namespace:name` shape, for instance — pass
 * their own `id` function. A flat id costs nothing to resolve, because it is
 * used as the registry key verbatim.
 */
function makeDefaultId(roots) {
  return (file) => {
    const root = roots.find((candidate) => file.startsWith(`${candidate.dir}${path.sep}`));
    if (!root) {
      return toModuleId(path.basename(file));
    }
    const relative = toModuleId(path.relative(root.dir, file));
    return root.prefix ? `${root.prefix}/${relative}` : relative;
  };
}

/**
 * Maps every template id to its absolute file path, so an include target can
 * be resolved to a module to import.
 */
function indexTemplates(roots, idFor) {
  const map = new Map();

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.twig')) {
        map.set(idFor(full), full);
      }
    }
  };

  for (const root of roots) {
    if (fs.existsSync(root.dir)) {
      walk(root.dir);
    }
  }

  return map;
}

/**
 * Compiles a `.twig` file into a module Astro can render.
 */
function compileTemplate(source, id, deps) {
  return [
    `import { registerTemplate, TWIG_COMPONENT } from ${JSON.stringify(SERVER)};`,
    ...deps.map((dep) => `import ${JSON.stringify(dep)};`),
    'const Component = {',
    `  id: ${JSON.stringify(id)},`,
    `  source: ${JSON.stringify(source)},`,
    '};',
    'Component[TWIG_COMPONENT] = true;',
    `Component[Symbol.for('astro:renderer')] = ${JSON.stringify(RENDERER)};`,
    'registerTemplate(Component.id, Component.source);',
    'export default Component;',
  ].join('\n');
}

function vitePluginTwig({ idFor, roots }) {
  let index = new Map();

  const reindex = () => {
    index = indexTemplates(roots, idFor);
  };

  return {
    name: 'vite-plugin-twig',
    enforce: 'pre',

    buildStart: reindex,

    /**
     * Dev-server reloading.
     *
     * Two things have to happen that Vite cannot do on its own.
     *
     * The compiled template is cached in twig.js's registry under its id, and
     * `registerTemplate` returns early for an id it already knows. Without
     * evicting, the module re-transforms with the new source, re-registers,
     * and the old markup renders anyway — an edit that appears to do nothing.
     *
     * Re-indexing covers an edit that adds a `{% include %}` of a template
     * that was not in the graph before, and a template file that is new since
     * the server started. The index is what turns an include target into a
     * module to import, so a stale one drops the dependency silently.
     *
     * Returning nothing leaves Vite to invalidate the module and its
     * importers as usual, which is what re-renders the pages that use it.
     */
    handleHotUpdate({ file }) {
      if (!file.endsWith('.twig')) {
        return;
      }
      reindex();
      evictTemplate(idFor(file));
    },

    async transform(_code, fileId) {
      if (!fileId.endsWith('.twig')) {
        return null;
      }

      if (index.size === 0) {
        reindex();
      }

      const source = await fsp.readFile(fileId, 'utf8');

      const deps = new Set();
      for (const target of includeTargets(source)) {
        const file = index.get(target);
        if (file && file !== fileId) {
          deps.add(toModuleId(file));
        }
      }

      return { code: compileTemplate(source, idFor(fileId), [...deps]), map: null };
    },
  };
}

/**
 * @param {object} options
 * @param {string|URL} options.components Directory holding the `.twig` files.
 * @param {Record<string, string|URL>} [options.namespaces] Extra roots, keyed
 *   by the prefix their templates are addressed under.
 * @param {(file: string) => string} [options.id] Derives a registry id from an
 *   absolute template path.
 * @param {Record<string, Function>} [options.functions] Registered as Twig
 *   functions.
 * @param {Record<string, Function>} [options.filters] Registered as Twig
 *   filters.
 * @param {(Twig: object) => void} [options.extensions] Escape hatch, handed
 *   the Twig instance.
 * @param {(props: object, slots: object) => object} [options.slots] Decides
 *   how named slots merge with props. Defaults to slots winning.
 */
export default function twig(options = {}) {
  const componentsDir = toPath(options.components);

  if (!componentsDir) {
    throw new Error('astro-twig: the `components` option is required.');
  }
  if (!fs.existsSync(componentsDir)) {
    throw new Error(`astro-twig: components directory not found: ${componentsDir}`);
  }

  const roots = resolveRoots(path.resolve(componentsDir), options.namespaces);
  const idFor = options.id || makeDefaultId(roots);

  configure(options);

  return {
    name: RENDERER,
    hooks: {
      'astro:config:setup': ({ addRenderer, updateConfig }) => {
        addRenderer({
          name: RENDERER,
          serverEntrypoint: SERVER,
          // No clientEntrypoint: Twig has no client runtime. Astro treats that
          // as legal, which is why the server entrypoint has to refuse
          // client:* itself.
        });
        updateConfig({
          vite: {
            plugins: [vitePluginTwig({ idFor, roots })],
            // astro-twig external so the renderer stays one module instance,
            // shared with the `configure` call above.
            ssr: { external: ['twig', 'astro-twig'] },
          },
        });
      },
    },
  };
}
