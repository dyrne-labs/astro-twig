/**
 * The include scan decides what becomes an ESM import, and therefore what is
 * registered before it is needed. A target it misses is a template that only
 * renders if something else happened to pull it in.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { includeTargets } from '../src/integration.mjs';

test('finds every tag that names another template', () => {
  const source = `
    {% include 'a.twig' %}
    {% extends 'b.twig' %}
    {% embed 'c.twig' %}{% endembed %}
    {% import 'd.twig' as helpers %}
    {% from 'e.twig' import thing %}
    {% use 'f.twig' %}
  `;
  assert.deepEqual(includeTargets(source), [
    'a.twig',
    'b.twig',
    'c.twig',
    'd.twig',
    'e.twig',
    'f.twig',
  ]);
});

test('survives whitespace control and irregular spacing', () => {
  const source = `{%- include 'a.twig' -%}{%include 'b.twig'%}{%    include    'c.twig' %}`;
  assert.deepEqual(includeTargets(source), ['a.twig', 'b.twig', 'c.twig']);
});

test('reads the target, not the props that follow it', () => {
  const source = `{% include 'card.twig' with { url: base ~ '/x', label: 'not-a-template' } only %}`;
  assert.deepEqual(includeTargets(source), ['card.twig']);
});

test('ignores unquoted targets', () => {
  // `_self` is how a template imports its own macros. It names no file.
  assert.deepEqual(includeTargets('{% import _self as menus %}'), []);
});

test('ignores a dynamically named target', () => {
  // Documented limit: renders if something else registered it, but cannot be
  // discovered here.
  assert.deepEqual(includeTargets(`{% include 'atoms/' ~ name ~ '.twig' %}`), ['atoms/']);
});

test('finds repeated and multi-line targets', () => {
  const source = `{% include 'a.twig' %}\n{% include 'a.twig' %}\n{% include 'b.twig' %}`;
  assert.deepEqual(includeTargets(source), ['a.twig', 'a.twig', 'b.twig']);
});
