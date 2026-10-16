import { describe, expect, it } from 'vitest';
import {
  BLUEPRINT_REPOS,
  blueprintFiles,
  contentsApiUrl,
  describeGithubError,
  looksLikeBlueprintText,
  parseContents,
  parseRepoRef,
  rawUrlFor,
  subdirectories,
  type GithubEntry,
} from '../src/ui/github.ts';

describe('repository reference parsing', () => {
  it('offers presets that all parse, so no button can be dead on arrival', () => {
    // A preset that fails to parse renders a button that only ever reports "not a repo".
    expect(BLUEPRINT_REPOS.length).toBeGreaterThan(0);
    for (const preset of BLUEPRINT_REPOS) {
      const ref = parseRepoRef(preset.repo);
      expect(ref, `${preset.label} -> ${preset.repo}`).not.toBeNull();
      expect(ref!.owner.length).toBeGreaterThan(0);
      expect(ref!.repo.length).toBeGreaterThan(0);
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.note.length).toBeGreaterThan(0);
    }
  });

  it('accepts the short owner/repo form', () => {
    expect(parseRepoRef('DysonSphereProgram/Blueprints')).toEqual({
      owner: 'DysonSphereProgram',
      repo: 'Blueprints',
      ref: 'HEAD',
      path: '',
    });
  });

  it('accepts a full repository URL and strips a .git suffix', () => {
    expect(parseRepoRef('https://github.com/someone/dsp-blueprints.git')).toMatchObject({
      owner: 'someone',
      repo: 'dsp-blueprints',
      ref: 'HEAD',
      path: '',
    });
  });

  it('reads the branch and folder out of a tree URL', () => {
    // Pasting a link to the folder you are looking at is the common case.
    expect(parseRepoRef('https://github.com/someone/dsp-blueprints/tree/main/蓝图/太阳能')).toEqual({
      owner: 'someone',
      repo: 'dsp-blueprints',
      ref: 'main',
      path: '蓝图/太阳能',
    });
  });

  it('reads a blob URL as the folder holding that file', () => {
    expect(parseRepoRef('https://github.com/a/b/blob/v2/out/x.txt')).toMatchObject({
      owner: 'a',
      repo: 'b',
      ref: 'v2',
      path: 'out/x.txt',
    });
  });

  it('refuses input that is not a repository reference', () => {
    // Returning null lets the UI say "that is not a repo" instead of requesting a nonsense URL.
    for (const bad of ['', '   ', 'justaname', 'https://example.com/a/b', 'https://github.com/onlyowner', '-bad/repo']) {
      expect(parseRepoRef(bad), bad).toBeNull();
    }
  });

  it('does not treat a similarly named host as GitHub', () => {
    expect(parseRepoRef('https://github.com.evil.test/a/b')).toBeNull();
  });
});

describe('URL building', () => {
  const ref = { owner: 'me', repo: 'bp', ref: 'main', path: '蓝图' };

  it('percent-encodes each path segment of the contents API URL', () => {
    const url = contentsApiUrl(ref);
    expect(url).toContain('/repos/me/bp/contents/');
    expect(url).toContain('?ref=main');
    // The Chinese folder name must be escaped, not passed through raw.
    expect(url).not.toContain('蓝图');
    expect(decodeURIComponent(url.split('/contents/')[1]!.split('?')[0]!)).toBe('蓝图');
  });

  it('escapes a file name that would otherwise truncate the URL', () => {
    // `#` starts a fragment, so an unescaped name containing one loses the rest of the path.
    const url = rawUrlFor({ ...ref, path: '' }, 'a folder/蓝图 #2.txt');
    expect(url).not.toContain('#');
    expect(url).toContain('a%20folder');
    expect(decodeURIComponent(url)).toContain('蓝图 #2.txt');
  });

  it('omits the path segment entirely for the repository root', () => {
    expect(contentsApiUrl({ owner: 'me', repo: 'bp', ref: 'HEAD', path: '' })).toBe(
      'https://api.github.com/repos/me/bp/contents?ref=HEAD',
    );
  });
});

describe('contents response parsing', () => {
  it('keeps well-formed rows and normalises missing sizes', () => {
    const entries = parseContents([
      { name: 'a.txt', path: 'a.txt', type: 'file', size: 12, download_url: 'u' },
      { name: 'dir', path: 'dir', type: 'dir' },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ name: 'a.txt', size: 12, downloadUrl: 'u' });
    expect(entries[1]).toMatchObject({ name: 'dir', type: 'dir', size: 0, downloadUrl: null });
  });

  it('returns nothing for shapes the API does not send for a listing', () => {
    // A file request answers with a single object, and an error answers with an object too.
    for (const bad of [null, undefined, {}, 'nope', 42, { message: 'Not Found' }]) {
      expect(parseContents(bad)).toEqual([]);
    }
  });

  it('drops rows missing a required field instead of inventing one', () => {
    expect(parseContents([{ name: 'a.txt', type: 'file' }, { path: 'b', type: 'file' }, { name: 'c', path: 'c' }])).toEqual(
      [],
    );
  });

  it('drops unknown entry types', () => {
    expect(parseContents([{ name: 'x', path: 'x', type: 'wormhole' }])).toEqual([]);
  });
});

describe('file selection', () => {
  const ref = { owner: 'me', repo: 'bp', ref: 'main', path: '' };
  const entries: GithubEntry[] = [
    { name: 'README.md', path: 'README.md', type: 'file', size: 100, downloadUrl: null },
    { name: '蓝图B.txt', path: '蓝图B.txt', type: 'file', size: 200, downloadUrl: null },
    { name: '蓝图A.txt', path: '蓝图A.txt', type: 'file', size: 300, downloadUrl: null },
    { name: 'packed.dybp', path: 'packed.dybp', type: 'file', size: 400, downloadUrl: null },
    { name: 'solar', path: 'solar', type: 'dir', size: 0, downloadUrl: null },
    { name: 'notes.TXT', path: 'notes.TXT', type: 'file', size: 10, downloadUrl: null },
  ];

  it('offers only .txt and .dybp files', () => {
    const files = blueprintFiles(entries, ref);
    expect(files.map((f) => f.name)).not.toContain('README.md');
    expect(files.map((f) => f.name)).not.toContain('solar');
    expect(files.map((f) => f.name).sort()).toEqual(['notes.TXT', '蓝图A.txt', '蓝图B.txt', 'packed.dybp'].sort());
  });

  it('prefers the API download_url and falls back to a raw URL', () => {
    const withUrl: GithubEntry = { name: 'a.txt', path: 'a.txt', type: 'file', size: 1, downloadUrl: 'https://x/a' };
    const without: GithubEntry = { name: 'a.txt', path: 'a.txt', type: 'file', size: 1, downloadUrl: null };
    expect(blueprintFiles([withUrl], ref)[0]!.rawUrl).toBe('https://x/a');
    expect(blueprintFiles([without], ref)[0]!.rawUrl).toContain('raw.githubusercontent.com/me/bp/main/a.txt');
  });

  it('lists subdirectories so a collection can be walked', () => {
    expect(subdirectories(entries).map((d) => d.name)).toEqual(['solar']);
  });
});

describe('error messages', () => {
  it('explains the unauthenticated rate limit rather than repeating the API text', () => {
    const message = describeGithubError(403, { message: 'API rate limit exceeded' }, '12:30');
    expect(message).toContain('60');
    expect(message).toContain('12:30');
  });

  it('distinguishes a missing repository from a rate limit', () => {
    expect(describeGithubError(404)).toContain('404');
    expect(describeGithubError(404)).not.toContain('60');
  });

  it('covers the remaining statuses without leaking an empty message', () => {
    expect(describeGithubError(401)).toContain('私有');
    expect(describeGithubError(503)).toContain('503');
    expect(describeGithubError(418)).toContain('418');
  });
});

describe('blueprint text detection', () => {
  it('accepts the two container prefixes', () => {
    expect(looksLikeBlueprintText('BLUEPRINT:0,10,1,2,3')).toBe(true);
    expect(looksLikeBlueprintText('  \n DYBPxxxx')).toBe(true);
  });

  it('rejects a text file that is not a blueprint, so the picker can say why', () => {
    expect(looksLikeBlueprintText('# Blueprint collection\n\nSee the table below.')).toBe(false);
    expect(looksLikeBlueprintText('')).toBe(false);
  });
});
