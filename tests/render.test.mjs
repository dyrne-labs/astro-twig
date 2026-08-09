/**
 * Smoke tests for the server entrypoint, exercised directly rather than
 * through an Astro build so they stay fast. The full matrix — extends, embed,
 * macros, the include-scan regex — lands with the options surface.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import renderer, { TWIG_COMPONENT, diskReadCount, registerTemplate } from '../src/server.mjs';

function component(id, source) {
  const handle = { id, source };
  handle[TWIG_COMPONENT] = true;
  return handle;
}

const LINK = component(
  'link.twig',
  `<a href="{{ url }}" class="l l--{{ theme|default('light') }}">{{ text }}</a>`,
);

const BUTTON = component(
  'button.twig',
  `{%- set size = size|default('regular') -%}
<div class="b b--{{ size }}">
{%- if url -%}
{% include 'link.twig' with { url: url, text: text, theme: theme } only %}
{%- else -%}
<button type="button">{{ text }}</button>
{%- endif -%}
{%- if content_bottom is not empty %}<i>{{ content_bottom }}</i>{%- endif %}
</div>`,
);

async function render(handle, props = {}, slots = {}, metadata = undefined) {
  const { html } = await renderer.renderToStaticMarkup(handle, props, slots, metadata);
  return html;
}

test('check() accepts twig handles and rejects anything else', () => {
  assert.equal(renderer.check(BUTTON), true);
  assert.equal(renderer.check({ id: 'not-twig' }), false);
  assert.equal(renderer.check(null), false);
  assert.equal(renderer.check(() => {}), false);
});

test('renders props and applies template defaults', async () => {
  const html = await render(BUTTON, { text: 'Go' });
  assert.match(html, /class="b b--regular"/);
  assert.match(html, /<button type="button">Go<\/button>/);
});

test('resolves an include from the registry', async () => {
  registerTemplate(LINK.id, LINK.source);
  const html = await render(BUTTON, { text: 'Go', url: '/somewhere', theme: 'dark' });
  assert.match(html, /<a href="\/somewhere" class="l l--dark">Go<\/a>/);
});

test('a slot lands in the matching template variable', async () => {
  const html = await render(BUTTON, { text: 'Go' }, { content_bottom: '<em>more</em>' });
  assert.match(html, /<i><em>more<\/em><\/i>/);
});

test('an explicit prop is not escaped into entities', async () => {
  const html = await render(LINK, { url: '/a?b=1&c=2', text: 'x' });
  assert.match(html, /href="\/a\?b=1&c=2"/);
});

test('refuses to hydrate', async () => {
  await assert.rejects(
    () => render(BUTTON, { text: 'Go' }, {}, { hydrate: 'load' }),
    /cannot hydrate. Remove client:load/,
  );
});

test('nothing reached the filesystem loader', () => {
  assert.equal(diskReadCount(), 0);
});
