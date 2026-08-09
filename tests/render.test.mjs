/**
 * Smoke tests for the server entrypoint, exercised directly rather than
 * through an Astro build so they stay fast. The full matrix — extends, embed,
 * macros, the include-scan regex — lands with the options surface.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import renderer, { TWIG_COMPONENT, configure, diskReadCount, registerTemplate } from '../src/server.mjs';

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

test('a slot that is an object, not a string, is coerced before Twig sees it', async () => {
  // Astro types slots as Record<string, string>, but passes objects that
  // stringify. A template that only interpolates a slot cannot tell; one that
  // iterates it walks the object's own keys and ends up with null, which
  // surfaces much later inside whatever filter touches it.
  // Shaped like what Astro actually hands over: own enumerable properties,
  // with toString on the prototype. An object literal will not do — it has no
  // keys for a loop to walk, so it fails to reproduce the bug.
  class SlotResult {
    constructor(html) {
      this.htmlParts = [html];
      this.expressions = [];
    }

    toString() {
      return this.htmlParts.join('');
    }
  }

  // Assert on what Twig is handed, not on what it renders. Interpolation looks
  // right either way, because Twig stringifies the object on output — the
  // damage only shows when a template iterates the slot, and then it surfaces
  // inside a twig.js filter with no mention of the template.
  let received;
  configure({
    slots: (props, slots) => {
      received = slots.items;
      return { ...props, ...slots };
    },
  });

  const html = await render(
    component('coerced.twig', '<p>{{ items }}</p>'),
    {},
    { items: new SlotResult('rendered markup') },
  );

  configure({ slots: (props, slots) => ({ ...props, ...slots }) });

  assert.equal(typeof received, 'string');
  assert.equal(received, 'rendered markup');
  assert.equal(html, '<p>rendered markup</p>');
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

test('extends resolves from the registry', async () => {
  registerTemplate('base.twig', '<div class="base">{% block body %}fallback{% endblock %}</div>');
  const child = component(
    'child.twig',
    `{% extends 'base.twig' %}{% block body %}overridden{% endblock %}`,
  );
  const html = await render(child);
  assert.match(html, /<div class="base">overridden<\/div>/);
});

test('embed resolves from the registry and fills its blocks', async () => {
  registerTemplate('card.twig', '<div class="card">{% block body %}empty{% endblock %}</div>');
  const embedder = component(
    'embedder.twig',
    `{% embed 'card.twig' %}{% block body %}filled{% endblock %}{% endembed %}`,
  );
  const html = await render(embedder);
  assert.match(html, /<div class="card">filled<\/div>/);
});

test('macros imported from _self render', async () => {
  const withMacro = component(
    'macro.twig',
    `{% import _self as m %}{% macro row(label) %}<li>{{ label }}</li>{% endmacro %}<ul>{{ m.row('x') }}</ul>`,
  );
  const html = await render(withMacro);
  assert.match(html, /<ul><li>x<\/li><\/ul>/);
});

test('nothing reached the filesystem loader', () => {
  assert.equal(diskReadCount(), 0);
});
