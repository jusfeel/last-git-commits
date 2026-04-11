'use strict';

/**
 * Node’s test runner does not treat a directory argument as “run all tests here”
 * (e.g. `node --test ./test/` tries to load that path as a module and fails).
 * This script expands `test/*.test.js` and passes those paths to `node --test`.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, '..', 'test');
const files = fs
    .readdirSync(testDir)
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => path.join(testDir, f))
    .sort();

if (files.length === 0) {
    console.error('No *.test.js files in test/');
    process.exit(1);
}

const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
