# last-git-commits

Read the latest commits from a git repo’s default branch (`origin/HEAD`, else `main` / `master`), with an optional JSON file cache. No dependencies beyond Node.js.

## Install

```bash
npm install last-git-commits
```

## Usage

```js
const {
  getReleaseNotes,
  getRecentCommitNotes,
  refreshCommitsCache,
  defaultOptions,
} = require('last-git-commits');

// Cached list (rebuilds synchronously on cold miss)
const { entries } = getReleaseNotes({
  repoRoot: '/path/to/repo',
  cacheDir: 'my-app', // optional: folder under os.tmpdir(), or an absolute path
});

// One-shot, no cache file
const { commits, branch } = getRecentCommitNotes({
  repoRoot: '/path/to/repo',
  limit: 20,
});
```

Commit entries are `{ created_at, title, detail, author }` where `title` is the short hash and `author` is `%an` from git (for release-note style UIs).

### Express (or any HTTP framework)

The library only talks to git and the filesystem. In your route, call `refreshCommitsCache` with paths and `repoRoot` (optional `limit`; defaults to `DEFAULT_BUILD_LIMIT`), then map the result to HTTP or `throw` / `next(err)`:

```js
const { refreshCommitsCache, defaultOptions } = require('last-git-commits');

const opts = {
  ...defaultOptions('my-app'), // cache dir name under os.tmpdir(), or absolute path
  repoRoot: '/path/to/repo',
};

app.post('/admin/commits/refresh', (req, res, next) => {
  const result = refreshCommitsCache({ ...opts });
  if (!result.ok) {
    return next(new Error(result.error));
  }
  res.json({ branch: result.branch, entryCount: result.entryCount });
});
```

## API

- **`defaultCachePaths(cacheDir?)`** — four file paths under that directory (see `defaultOptions`).
- **`defaultOptions(cacheDir?)`** — `{ repoRoot, cacheFile, cacheTmp, metaFile, metaTmp }` using `process.cwd()` and `cacheDir` (absolute path, or a folder name under `os.tmpdir()`, default `last-git-commits`).
- **`getReleaseNotes(overrides?)`** — returns `{ source: 'cache', entries }`. If the cache file is missing and the rebuild fails, **`throws`** an `Error` whose message comes from `refreshCommitsCache` (no `console` logging).
- **`refreshCommitsCache(options)`** — writes cache + meta; returns `{ ok, branch?, entryCount? }` or `{ ok: false, error }`. Omits `limit` to use `DEFAULT_BUILD_LIMIT` (10).
- **`getRecentCommitNotes({ repoRoot, limit, gitBinary? })`**

## License

MIT
