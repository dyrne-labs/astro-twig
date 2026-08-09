/**
 * Dev-server reloading, against a running `astro dev`.
 *
 * This is the one behaviour that cannot be checked by inspection: the failure
 * mode is a stale compiled template still sitting in twig.js's registry, which
 * looks exactly like a correct build until you edit something.
 *
 * The fixture is copied to a temp directory first, because the test edits
 * templates as it goes.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dev } from 'astro';

const FIXTURE = path.resolve(import.meta.dirname, 'fixtures/project');

// Inside the package, not the system temp directory: `astro` and `astro-twig`
// have to resolve, and node resolution only walks up from where the project
// actually sits.
const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');

let root;
let server;
let origin;

/**
 * Fetches the page until it satisfies `predicate`, or gives up.
 *
 * Polling rather than a fixed wait: the file watcher, the invalidation and the
 * re-render are all asynchronous, and a sleep long enough to be reliable would
 * be far longer than this usually takes.
 */
async function pageUntil(predicate, { attempts = 200, intervalMs = 100 } = {}) {
  let html = '';
  for (let i = 0; i < attempts; i += 1) {
    html = await (await fetch(origin)).text();
    if (predicate(html)) {
      return html;
    }
    await new Promise((resolve) => { setTimeout(resolve, intervalMs); });
  }
  // Falls through to the caller's assertion, which reports the stale markup.
  // The budget is generous because these files run in parallel with a suite
  // that also builds; a tight one turns a slow machine into a flaky test.
  return html;
}

function template(name) {
  return path.join(root, 'src/components', name);
}

before(async () => {
  root = fs.mkdtempSync(path.join(PACKAGE_DIR, '.hmr-'));
  fs.cpSync(FIXTURE, root, { recursive: true });

  server = await dev({ root, logLevel: 'silent', server: { port: 0 } });
  origin = `http://localhost:${server.address.port}/`;
}, { timeout: 120000 });

after(async () => {
  if (server) {
    await server.stop();
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('the page renders to begin with', async () => {
  const html = await pageUntil((page) => page.includes('<a href="/a">included</a>'));
  assert.match(html, /<a href="\/a">included<\/a>/);
});

test('editing a template updates the page', async () => {
  const file = template('kitchen-sink.twig');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('<section>', '<section id="edited">'));

  const html = await pageUntil((page) => page.includes('id="edited"'));
  assert.match(html, /<section id="edited">/);
});

test('editing an included template updates the page', async () => {
  // The page imports kitchen-sink, which includes link. Nothing imports link
  // directly, so this only works if the include edge is a module edge.
  const file = template('link.twig');
  fs.writeFileSync(file, '<a href="{{ url }}" data-edited>{{ text }}</a>\n');

  const html = await pageUntil((page) => page.includes('data-edited'));
  assert.match(html, /<a href="\/a" data-edited>included<\/a>/);
});

test('an edit that adds a new include pulls the new template in', async () => {
  // A template that was not in the graph at all when the server started.
  fs.writeFileSync(template('late.twig'), '<p class="late">arrived later</p>\n');

  const file = template('kitchen-sink.twig');
  fs.writeFileSync(
    file,
    fs.readFileSync(file, 'utf8').replace('</section>', "{% include 'late.twig' %}\n</section>"),
  );

  const html = await pageUntil((page) => page.includes('class="late"'));
  assert.match(html, /<p class="late">arrived later<\/p>/);
});
