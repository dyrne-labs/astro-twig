/**
 * The package is developed inside a design-system monorepo but is meant to be
 * extracted and reused. Repo separation would normally enforce that; while it
 * lives here, this test does.
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
