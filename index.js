/**
 * Recent commits from the repo’s default branch, with optional JSON cache on disk.
 *
 * @typedef {{ created_at: string, title: string, detail: string, author: string }} CommitEntry
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const MAX_COMMITS = 100;
const DEFAULT_BUILD_LIMIT = 10;

/**
 * @param {string} [cacheDir='last-git-commits'] — cache directory: absolute path, or a name under os.tmpdir()
 * @returns {{ cacheFile: string, cacheTmp: string, metaFile: string, metaTmp: string }}
 */
function defaultCachePaths(cacheDir = 'last-git-commits') {
    const base = path.isAbsolute(cacheDir) ? cacheDir : path.join(os.tmpdir(), cacheDir);
    return {
        cacheFile: path.join(base, 'commits-cache.json'),
        cacheTmp: path.join(base, 'commits-cache.json.tmp'),
        metaFile: path.join(base, 'commits-cache.meta.json'),
        metaTmp: path.join(base, 'commits-cache.meta.json.tmp'),
    };
}

/**
 * @returns {{ repoRoot: string } & ReturnType<typeof defaultCachePaths>}
 */
function defaultOptions(cacheDir = 'last-git-commits') {
    return {
        repoRoot: process.cwd(),
        ...defaultCachePaths(cacheDir),
    };
}

function writeAtomicJson(filePath, tmpPath, obj) {
    const payload = JSON.stringify(obj, null, 2);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmpPath, payload, 'utf8');
    fs.renameSync(tmpPath, filePath);
}

/**
 * @param {string} cacheFile
 * @returns {unknown[]|null}
 */
function readCachedCommits(cacheFile) {
    if (!fs.existsSync(cacheFile)) {
        return null;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        return Array.isArray(parsed) ? parsed : null;
    } catch (_) {
        return null;
    }
}

function execGit(gitBinary, repoRoot, args, execOpts) {
    return execFileSync(gitBinary, ['-C', repoRoot, ...args], {
        encoding: 'utf8',
        ...execOpts,
    });
}

function resolveMainBranch(gitBinary, repoRoot) {
    try {
        const out = execGit(gitBinary, repoRoot, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], {}).trim();
        const branch = out.replace(/^refs\/remotes\/origin\//, '');
        if (branch) {
            execGit(gitBinary, repoRoot, ['rev-parse', '--verify', branch], {});
            return branch;
        }
    } catch (_) {
        /* fall through */
    }
    for (const b of ['main', 'master']) {
        try {
            execGit(gitBinary, repoRoot, ['rev-parse', '--verify', b], {});
            return b;
        } catch (_) {
            /* try next */
        }
    }
    return null;
}

function gitRecentCommits(gitBinary, repoRoot, branch, limit) {
    const stdout = execGit(
        gitBinary,
        repoRoot,
        ['log', branch, '-n', String(limit), '--pretty=format:%H%x09%an%x09%s%x09%ci', '--no-color'],
        { maxBuffer: 10 * 1024 * 1024 }
    );
    const entries = [];
    for (const line of stdout.split('\n')) {
        if (!line.trim()) {
            continue;
        }
        const t1 = line.indexOf('\t');
        const t2 = line.indexOf('\t', t1 + 1);
        const t3 = line.indexOf('\t', t2 + 1);
        if (t1 < 0 || t2 < 0 || t3 < 0) {
            continue;
        }
        const full = line.slice(0, t1);
        const author = line.slice(t1 + 1, t2);
        const subject = line.slice(t2 + 1, t3);
        const ci = line.slice(t3 + 1);
        const hash7 = full.slice(0, 7).toLowerCase();
        const created_at = ci.replace('T', ' ').replace(/ [+-]\d{4}$/, '').slice(0, 19);
        entries.push({
            created_at,
            title: hash7,
            detail: subject,
            author,
        });
    }
    return entries;
}

/**
 * @param {{ repoRoot: string, limit: number, gitBinary?: string }} opts
 * @returns {{ commits: CommitEntry[], branch: string|null }}
 */
function getRecentCommitNotes(opts) {
    const { repoRoot, limit, gitBinary = 'git' } = opts;
    const effectiveLimit = Math.min(Math.max(1, limit), MAX_COMMITS);
    if (!fs.existsSync(path.join(repoRoot, '.git'))) {
        return { commits: [], branch: null };
    }
    const branch = resolveMainBranch(gitBinary, repoRoot);
    if (!branch) {
        return { commits: [], branch: null };
    }
    return {
        commits: gitRecentCommits(gitBinary, repoRoot, branch, effectiveLimit),
        branch,
    };
}

/**
 * @param {{
 *   repoRoot: string,
 *   limit?: number,
 *   gitBinary?: string,
 *   cacheFile: string,
 *   cacheTmp: string,
 *   metaFile: string,
 *   metaTmp: string,
 * }} options
 * @returns {{ ok: true, branch: string|null, entryCount: number } | { ok: false, error: string }}
 */
function refreshCommitsCache(options) {
    const { repoRoot, limit = DEFAULT_BUILD_LIMIT, gitBinary, cacheFile, cacheTmp, metaFile, metaTmp } = options;
    try {
        const { commits: rows, branch } = getRecentCommitNotes({
            repoRoot,
            limit,
            gitBinary,
        });
        writeAtomicJson(cacheFile, cacheTmp, rows);
        writeAtomicJson(metaFile, metaTmp, {
            updatedAt: new Date().toISOString(),
            branch,
            entryCount: rows.length,
        });
        return { ok: true, branch, entryCount: rows.length };
    } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        try {
            writeAtomicJson(metaFile, metaTmp, {
                updatedAt: new Date().toISOString(),
                error: err,
            });
        } catch (_) {
            /* ignore meta write failure */
        }
        return { ok: false, error: err };
    }
}

/**
 * @param {Partial<{
 *   repoRoot: string,
 *   limit: number,
 *   gitBinary: string,
 *   cacheFile: string,
 *   cacheTmp: string,
 *   metaFile: string,
 *   metaTmp: string,
 *   cacheDir: string,
 * }>} [overrides]
 * @returns {{ source: 'cache', entries: unknown[] }}
 * @throws {Error} When the cache was missing and `refreshCommitsCache` failed.
 */
function getReleaseNotes(overrides = {}) {
    const base =
        overrides.cacheFile != null
            ? {
                  repoRoot: overrides.repoRoot ?? process.cwd(),
                  ...overrides,
              }
            : { ...defaultOptions(overrides.cacheDir), ...overrides };

    const o = {
        repoRoot: base.repoRoot,
        cacheFile: base.cacheFile,
        cacheTmp: base.cacheTmp,
        metaFile: base.metaFile,
        metaTmp: base.metaTmp,
        gitBinary: base.gitBinary,
    };

    const buildLimit =
        overrides.limit != null ? Math.min(Math.max(1, overrides.limit), MAX_COMMITS) : DEFAULT_BUILD_LIMIT;

    let entries = readCachedCommits(o.cacheFile);
    if (entries !== null) {
        return { source: 'cache', entries };
    }

    const result = refreshCommitsCache({ ...o, limit: buildLimit });
    if (!result.ok) {
        throw new Error(result.error);
    }
    entries = readCachedCommits(o.cacheFile);
    return { source: 'cache', entries: entries !== null ? entries : [] };
}

module.exports = {
    MAX_COMMITS,
    DEFAULT_BUILD_LIMIT,
    defaultCachePaths,
    defaultOptions,
    getRecentCommitNotes,
    refreshCommitsCache,
    getReleaseNotes,
    readCachedCommits,
};
