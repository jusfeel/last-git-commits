'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { getRecentCommitNotes } = require('../index.js');

function git(repo, args, env = {}) {
    execFileSync('git', ['-C', repo, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
    });
}

test('created_at is UTC ISO from git committer offset (+0000)', async (t) => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'last-git-commits-test-'));
    t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

    git(repo, ['init', '-b', 'main']);
    git(repo, ['config', 'user.email', 't@example.test']);
    git(repo, ['config', 'user.name', 'Tester']);

    fs.writeFileSync(path.join(repo, 'a.txt'), '1');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '-m', 'utc commit'], {
        GIT_AUTHOR_DATE: '2026-04-10 14:04:48 +0000',
        GIT_COMMITTER_DATE: '2026-04-10 14:04:48 +0000',
    });

    const { commits, branch } = getRecentCommitNotes({ repoRoot: repo, limit: 5 });
    assert.equal(branch, 'main');
    assert.equal(commits.length, 1);
    assert.equal(commits[0].created_at, '2026-04-10T14:04:48.000Z');
});

test('created_at normalizes non-UTC offset to the same instant', async (t) => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'last-git-commits-test-'));
    t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

    git(repo, ['init', '-b', 'main']);
    git(repo, ['config', 'user.email', 't@example.test']);
    git(repo, ['config', 'user.name', 'Tester']);

    fs.writeFileSync(path.join(repo, 'b.txt'), '1');
    git(repo, ['add', 'b.txt']);
    // 22:04 +0900 === 13:04 Z
    git(repo, ['commit', '-m', 'tokyo wall time'], {
        GIT_AUTHOR_DATE: '2026-04-10 22:04:48 +0900',
        GIT_COMMITTER_DATE: '2026-04-10 22:04:48 +0900',
    });

    const { commits } = getRecentCommitNotes({ repoRoot: repo, limit: 5 });
    assert.equal(commits[0].created_at, '2026-04-10T13:04:48.000Z');
});
