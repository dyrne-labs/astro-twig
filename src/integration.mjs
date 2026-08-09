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

const RENDERER = 'astro-twig';

const INCLUDE_RE = /\{%-?\s*(?:include|extends|embed)\s+'([^']+)'/g;

/**
 * Vite module ids use forward slashes on every platform.
 */
function toModuleId(absolutePath) {
  return absolutePath.split(path.sep).join('/');
}

const SERVER = toModuleId(fileURLToPath(new URL('./server.mjs', import.meta.url)));

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
 * Default registry id: the template's path relative to the components
 * directory, extension included. `atoms/button.twig` includes as
 * `{% include 'atoms/button.twig' %}`.
 *
 * Projects using flat ids — a `namespace:name` shape, for instance — pass
 * their own `id` function. A flat id costs nothing to resolve, because it is
 * used as the registry key verbatim.
 */
function makeDefaultId(componentsDir) {
  return (file) => toModuleId(path.relative(componentsDir, file));
}

/**
 * Maps every template id in a directory tree to its absolute file path, so an
 * include target can be resolved to a module to import.
 */
function indexTemplates(dir, idFor) {
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
  walk(dir);
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

function vitePluginTwig({ idFor, componentsDir }) {
  let index = new Map();

  return {
    name: 'vite-plugin-twig',
    enforce: 'pre',

    buildStart() {
      index = indexTemplates(componentsDir, idFor);
    },

    async transform(_code, fileId) {
      if (!fileId.endsWith('.twig')) {
        return null;
      }

      const source = await fsp.readFile(fileId, 'utf8');

      const deps = new Set();
      for (const match of source.matchAll(INCLUDE_RE)) {
        const target = index.get(match[1]);
        if (target && target !== fileId) {
          deps.add(toModuleId(target));
        }
      }

      return { code: compileTemplate(source, idFor(fileId), [...deps]), map: null };
    },
  };
}

/**
 * @param {object} options
 * @param {string|URL} options.components Directory holding the `.twig` files.
 * @param {(file: string) => string} [options.id] Derives a registry id from an
 *   absolute template path. Defaults to the path relative to `components`.
 */
export default function twig(options = {}) {
  const componentsDir = toPath(options.components);

  if (!componentsDir) {
    throw new Error('astro-twig: the `components` option is required.');
  }
  if (!fs.existsSync(componentsDir)) {
    throw new Error(`astro-twig: components directory not found: ${componentsDir}`);
  }

  const idFor = options.id || makeDefaultId(componentsDir);

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
            plugins: [vitePluginTwig({ idFor, componentsDir })],
            ssr: { external: ['twig'] },
          },
        });
      },
    },
  };
}
