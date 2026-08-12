/**
 * The package was written inside a design-system monorepo and kept generic so it
 * could be extracted. It has been, and this test is what made the extraction a
 * move rather than an untangling — so it stays, now guarding the other
 * direction: the package's first consumer is still that design system, and a
 * change made while looking at that consumer is the one likely to leak.
 *
 * Anything project-specific must arrive through the integration's options, not
 * be written into the package.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');

const SKIP_DIRS = new Set(['node_modules', 'dist', '.astro', '.git']);

// This file necessarily contains the words it searches for.
const SKIP_FILES = new Set([import.meta.filename]);

const FORBIDDEN = /civictheme|drupal|\bsdc\b/i;

function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        found.push(...sourceFiles(full));
      }
    } else if (!SKIP_FILES.has(full) && entry.name !== 'package-lock.json') {
      found.push(full);
    }
  }
  return found;
}

test('carries no knowledge of any specific design system', () => {
  const offenders = sourceFiles(PACKAGE_DIR)
    .filter((file) => FORBIDDEN.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(PACKAGE_DIR, file));

  assert.deepEqual(
    offenders,
    [],
    `astro-twig must stay generic so it can be extracted. Move these references behind an option: ${offenders.join(', ')}`,
  );
});
