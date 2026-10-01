import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHECK_INTERVAL_MS,
  GITHUB_URL_BUDGET,
  MAILTO_URL_BUDGET,
  checkForUpdate,
  collectDiagnostics,
  compareVersions,
  describeOs,
  fitBody,
  formatReport,
  githubIssueUrl,
  mailtoUrl,
  recordError,
  reportTitle,
  setAutoCheck,
  skipVersion,
  type AppIdentity,
  type SettingsStore,
} from './index.ts';

const app: AppIdentity = {
  name: 'Unsold PDF',
  version: '0.1.0',
  build: 'abc1234',
  distribution: 'direct',
  repo: 'jans-johnson/unsold-pdf',
  email: 'support@stayunsold.com',
  manifestUrl: 'https://pdf.stayunsold.com/releases/latest.json',
};

const memory = (): SettingsStore => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
};
const release = (version: string) => ({
  app: 'Unsold PDF',
  version,
  url: 'https://pdf.stayunsold.com/#download',
});

describe('compareVersions', () => {
  it('orders semver, including pre-releases and short forms', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0);
  });
});

describe('checkForUpdate', () => {
  let settings: SettingsStore;
  beforeEach(() => (settings = memory()));
  const run = (version: string, opts: { force?: boolean; now?: number } = {}) =>
    checkForUpdate(app, {
      settings,
      getManifest: async () => release(version),
      ...opts,
    });

  it('reports a newer version, and nothing for the same one', async () => {
    expect((await run('0.2.0')).status).toBe('available');
    expect((await run('0.1.0', { force: true })).status).toBe('current');
  });

  it('checks at most once a day unless asked', async () => {
    await run('0.1.0', { now: 1_000 });
    expect(await run('0.2.0', { now: 2_000 })).toEqual({
      status: 'skipped',
      reason: 'recent',
    });
    expect(
      (await run('0.2.0', { now: 1_000 + CHECK_INTERVAL_MS })).status
    ).toBe('available');
    expect((await run('0.2.0', { now: 3_000, force: true })).status).toBe(
      'available'
    );
  });

  it('respects the off switch, but not for a manual check', async () => {
    setAutoCheck(false, settings);
    expect(await run('0.2.0')).toEqual({ status: 'skipped', reason: 'off' });
    expect((await run('0.2.0', { force: true })).status).toBe('available');
  });

  it('stays quiet about a version the person said "not now" to', async () => {
    skipVersion('0.2.0', settings);
    expect(await run('0.2.0', { now: 0 })).toEqual({
      status: 'skipped',
      reason: 'dismissed',
    });
    expect((await run('0.3.0', { now: 10 * CHECK_INTERVAL_MS })).status).toBe(
      'available'
    );
  });

  it('never checks store builds', async () => {
    const r = await checkForUpdate(
      { ...app, distribution: 'store' },
      { settings, force: true, getManifest: async () => release('9.0.0') }
    );
    expect(r).toEqual({ status: 'skipped', reason: 'store' });
  });

  it('rejects malformed or non-https manifests', async () => {
    for (const bad of [
      null,
      { version: 'latest', url: 'https://x' },
      { version: '1.0.0', url: 'http://insecure.example' },
    ]) {
      const r = await checkForUpdate(app, {
        settings: memory(),
        getManifest: async () => bad,
      });
      expect(r.status).toBe('error');
    }
  });

  it('reports network failures as errors', async () => {
    const r = await checkForUpdate(app, {
      settings,
      getManifest: async () => {
        throw new Error('offline');
      },
    });
    expect(r).toEqual({ status: 'error', error: 'offline' });
  });
});

describe('reports', () => {
  const env = {
    platform: 'macos',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    language: 'en-AU',
    screen: '1440×900 @2x',
    extra: [['View', 'home']] as [string, string][],
  };

  it('describes common operating systems', () => {
    expect(describeOs(env.userAgent)).toBe('macOS 10.15.7');
    expect(describeOs('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe(
      'Android 14'
    );
    expect(
      describeOs('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)')
    ).toBe('iOS 17.4');
    expect(describeOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
      'Windows NT 10.0'
    );
    expect(describeOs('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
  });

  it('includes app, device and recent errors', () => {
    recordError(new TypeError('boom'));
    recordError(new TypeError('boom')); // repeats are collapsed
    const d = collectDiagnostics(app, env);
    const get = (label: string) => d.find(([l]) => l === label)?.[1];
    expect(get('App')).toBe('Unsold PDF 0.1.0 (build abc1234)');
    expect(get('Installed from')).toBe('direct download');
    expect(get('View')).toBe('home');
    expect(get('Recent errors')?.match(/TypeError: boom/g)).toHaveLength(1);
  });

  it('formats plain text and markdown', () => {
    const d = collectDiagnostics(app, env);
    expect(formatReport('It crashed', d)).toMatch(
      /^What happened:\nIt crashed/
    );
    expect(formatReport('', d, { markdown: true })).toContain('```');
  });

  it('titles from the first line', () => {
    expect(reportTitle(app, '')).toBe('Unsold PDF 0.1.0: problem report');
    expect(reportTitle(app, 'OCR hangs\nmore')).toBe('OCR hangs');
    expect(reportTitle(app, 'x'.repeat(200))).toHaveLength(72);
  });

  it('keeps links within what browsers and mail apps accept', () => {
    const long = 'détails '.repeat(2000);
    const gh = githubIssueUrl(app, 'Title', long);
    expect(
      gh.startsWith('https://github.com/jans-johnson/unsold-pdf/issues/new?')
    ).toBe(true);
    expect(gh.length).toBeLessThan(GITHUB_URL_BUDGET + 200);
    expect(decodeURIComponent(gh)).toContain('Report trimmed to fit');
    const mail = mailtoUrl(app, 'Subject', long);
    expect(
      mail.startsWith('mailto:support@stayunsold.com?subject=Subject')
    ).toBe(true);
    expect(mail.length).toBeLessThan(MAILTO_URL_BUDGET + 100);
    expect(fitBody('short', 100)).toBe('short');
  });
});
