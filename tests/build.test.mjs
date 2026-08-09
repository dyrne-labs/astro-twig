/**
 * Runs a full `astro build` against a fixture project.
 *
 * The unit tests exercise the renderer directly; this is the only place that
 * proves the pieces fit together through Astro and Vite — in particular that
 * `configure()` reaches the same module instance Astro loads as the renderer.
 * If the package ever stops being ssr-external, custom functions vanish and
 * this is what catches it.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'astro';

const ROOT = path.resolve(import.meta.dirname, 'fixtures/project');

let html = '';

before(async () => {
  await build({ root: ROOT, logLevel: 'error' });
  html = fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8');
}, { timeout: 120000 });

test('a whitespace-controlled include is still found by the scan', () => {
  assert.match(html, /<a href="\/a">included<\/a>/);
});

test('a namespaced include resolves', () => {
  assert.match(html, /<span class="badge">namespaced<\/span>/);
});

test('a custom function reaches the renderer', () => {
  assert.match(html, /<p class="fn">LOUD<\/p>/);
});

test('a custom filter reaches the renderer', () => {
  assert.match(html, /<p class="filter">filtered!<\/p>/);
});

test('the extensions hook reaches the renderer', () => {
  assert.match(html, /<p class="ext">extension-ran<\/p>/);
});

test('macros imported from _self render', () => {
  assert.match(html, /<li class="depth-1">first<\/li>/);
  assert.match(html, /<li class="depth-2">second<\/li>/);
});

test('a named slot lands in the matching variable', () => {
  assert.match(html, /<div class="slot">slot content<\/div>/);
});

test('the slots option decides who wins a name collision', () => {
  assert.match(html, /<div class="wins">prop wins<\/div>/);
});
