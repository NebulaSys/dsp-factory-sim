/**
 * Reading blueprints from a GitHub repository.
 *
 * Browsing uses the public REST contents API and downloads use `raw.githubusercontent.com`.
 * Both send permissive CORS headers, so this works from the page without a proxy — but the
 * unauthenticated API is rate limited (60 requests per hour per IP, shared by everyone behind
 * the same address), and a published blueprint collection is often full of files that are not
 * blueprints at all. The helpers here are separated from the fetching so the parsing, URL
 * building and error mapping can be tested without a network.
 */

/** One entry as the GitHub contents API reports it. */
export interface GithubEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  size: number;
  downloadUrl: string | null;
}

/** A file that could be a blueprint, with the URL to fetch its bytes. */
export interface BlueprintFile {
  name: string;
  path: string;
  rawUrl: string;
  size: number;
}

export interface RepoRef {
  owner: string;
  repo: string;
  /** Branch, tag or commit; `HEAD` lets raw.githubusercontent resolve the default branch. */
  ref: string;
  /** Directory inside the repository. */
  path: string;
}

/** A one-click starting point offered in the blueprint view. */
export interface RepoPreset {
  label: string;
  repo: string;
  note: string;
}

/**
 * Repositories and folders offered as ready-made entry points.
 *
 * These are offered as buttons rather than pre-filled into the input, so a repository the user
 * typed is not overwritten by simply opening the page. Every entry must parse through
 * `parseRepoRef`, which the tests check — a preset that cannot be parsed would render a button
 * that only ever reports an error.
 *
 * `DSPBluePrints/FactoryBluePrints` is the collection this project's own reverse-engineering
 * corpus came from. Its **root contains only category folders**, so pointing a single button
 * there would make the user drill through two more levels before anything loads; the two
 * category links below are folders that hold blueprint files directly. The counts are a
 * point-in-time observation of the live API, not a promise — the repository is updated by its
 * maintainers and both the counts and the folder names can change.
 */
export const BLUEPRINT_REPOS: RepoPreset[] = [
  {
    label: 'DSPBluePrints / FactoryBluePrints',
    repo: 'https://github.com/DSPBluePrints/FactoryBluePrints',
    note: '中文社区工厂蓝图仓库。根目录只有分类文件夹，点进去再选文件。',
  },
  {
    label: '基础材料 Basic-Materials',
    repo: 'https://github.com/DSPBluePrints/FactoryBluePrints/tree/main/基础材料_Basic-Materials',
    note: '该分类目录直接含蓝图文件（写这个按钮时实测 62 个），点文件名即可载入。',
  },
  {
    label: '建筑黑盒 Mall',
    repo: 'https://github.com/DSPBluePrints/FactoryBluePrints/tree/main/建筑黑盒-Mall',
    note: '该分类目录直接含蓝图文件（写这个按钮时实测 64 个），且下面没有子目录。',
  },
];

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const REPO_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Parses what a user is likely to paste: `owner/repo`, a full GitHub URL, or a URL pointing at
 * a folder inside a repository.
 *
 * Returns `null` rather than guessing when the input is not a repository reference, so the UI
 * can say so instead of firing a request at a nonsense URL.
 */
export function parseRepoRef(input: string): RepoRef | null {
  const text = input.trim();
  if (!text) return null;

  const fromUrl = (url: URL): RepoRef | null => {
    if (!/(^|\.)github\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const [owner, repo, marker, ...rest] = parts;
    if (!owner || !repo) return null;
    if (!OWNER_RE.test(owner)) return null;
    const clean = repo.replace(/\.git$/i, '');
    if (!REPO_RE.test(clean)) return null;
    // `/<owner>/<repo>/tree/<ref>/<path...>` or `/<owner>/<repo>/blob/<ref>/<path...>`.
    if (marker === 'tree' || marker === 'blob') {
      const [ref, ...dir] = rest;
      return { owner, repo: clean, ref: ref || 'HEAD', path: dir.join('/') };
    }
    return { owner, repo: clean, ref: 'HEAD', path: '' };
  };

  if (/^https?:\/\//i.test(text)) {
    try {
      return fromUrl(new URL(text));
    } catch {
      return null;
    }
  }

  const parts = text.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo, ...rest] = parts;
  if (!owner || !repo || !OWNER_RE.test(owner)) return null;
  const clean = repo.replace(/\.git$/i, '');
  if (!REPO_RE.test(clean)) return null;
  return { owner, repo: clean, ref: 'HEAD', path: rest.join('/') };
}

/** URL of the contents API for a directory. */
export function contentsApiUrl(ref: RepoRef): string {
  const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}/contents`;
  const path = ref.path ? `/${encodePath(ref.path)}` : '';
  return `${base}${path}?ref=${encodeURIComponent(ref.ref)}`;
}

/**
 * URL of a file's raw bytes.
 *
 * Each path segment is encoded individually: blueprint files routinely carry spaces, `#`, and
 * non-ASCII names, and leaving those unescaped truncates the URL at the `#`.
 */
export function rawUrlFor(ref: RepoRef, path: string): string {
  return `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${encodeURIComponent(ref.ref)}/${encodePath(path)}`;
}

function encodePath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Validates a contents-API response into entries.
 *
 * The API answers with an array for a directory and a single object for a file, and error
 * responses have neither shape. Anything unexpected yields an empty list so the caller shows
 * "nothing here" instead of throwing on a field it assumed.
 */
export function parseContents(json: unknown): GithubEntry[] {
  if (!Array.isArray(json)) return [];
  const entries: GithubEntry[] = [];
  for (const raw of json) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name : null;
    const path = typeof row.path === 'string' ? row.path : null;
    const type = typeof row.type === 'string' ? row.type : null;
    if (!name || !path || !type) continue;
    if (type !== 'file' && type !== 'dir' && type !== 'symlink' && type !== 'submodule') continue;
    entries.push({
      name,
      path,
      type,
      size: typeof row.size === 'number' && Number.isFinite(row.size) ? row.size : 0,
      downloadUrl: typeof row.download_url === 'string' ? row.download_url : null,
    });
  }
  return entries;
}

/**
 * Filters and orders a directory listing down to files worth trying to open.
 *
 * A blueprint export is recognised by its extension. The game writes `.txt`, and this project's
 * own binary container is `.dybp`; everything else — READMEs, images, the `.json` indexes some
 * collections ship — is dropped so the picker only offers plausible blueprints.
 */
export function blueprintFiles(entries: GithubEntry[], ref: RepoRef): BlueprintFile[] {
  return entries
    .filter((entry) => entry.type === 'file' && /\.(txt|dybp)$/i.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: entry.path,
      rawUrl: entry.downloadUrl ?? rawUrlFor(ref, entry.path),
      size: entry.size,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

/** Sub-directories of a listing, so a collection can be walked. */
export function subdirectories(entries: GithubEntry[]): GithubEntry[] {
  return entries.filter((entry) => entry.type === 'dir').sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

/**
 * Turns a failed request into something a user can act on.
 *
 * The unauthenticated rate limit is the failure people will actually hit, and the raw API
 * message ("API rate limit exceeded") does not say what to do about it.
 */
export function describeGithubError(status: number, body?: unknown, rateLimitReset?: string | null): string {
  const detail =
    typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).message === 'string'
      ? ((body as Record<string, unknown>).message as string)
      : '';
  if (status === 404) return '找不到这个仓库或目录：GitHub 返回 404。请检查仓库名、分支名和路径是否正确，以及仓库是否为公开。';
  if (status === 403 || status === 429) {
    const when = rateLimitReset ? `（限额将在 ${rateLimitReset} 重置）` : '';
    return `GitHub 接口调用次数已用尽：未登录的请求每小时只能发 60 次${when}。可以稍后再试，或改用「粘贴蓝图串」的方式。`;
  }
  if (status === 401) return 'GitHub 拒绝了这次请求（401）：这是个私有仓库，需要授权才能读取。';
  if (status >= 500) return `GitHub 服务端错误（${status}）。这是对方的问题，稍后再试。`;
  return `GitHub 请求失败（HTTP ${status}）${detail ? `：${detail}` : ''}`;
}

/**
 * A blueprint file is only useful if it is a blueprint.
 *
 * Collections also hold `.txt` files that are notes or changelogs, so the content is checked
 * before it is handed to the decoder, and the reason is reported rather than a decode error
 * from deep inside the parser.
 */
export function looksLikeBlueprintText(text: string): boolean {
  const head = text.trimStart().slice(0, 32).toUpperCase();
  return head.startsWith('BLUEPRINT:') || head.startsWith('DYBP');
}
