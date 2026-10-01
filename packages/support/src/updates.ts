import type { AppIdentity } from './app.ts';

/**
 * The file each app publishes at its manifest URL, updated as the last step
 * of a release (once the downloads are live):
 *   { "app": "Unsold PDF", "version": "0.2.0", "released": "2026-10-20",
 *     "notes": "One line on what's new.", "url": "https://pdf.stayunsold.com/#download" }
 */
export interface ReleaseManifest {
  app: string;
  version: string;
  released?: string;
  notes?: string;
  /** Where to get it: the download page (direct builds). */
  url: string;
}

/** Compares semver strings: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre = ''] = v.trim().replace(/^v/, '').split('-', 2);
    const nums = core.split('.').map((n) => parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, pre };
  };
  const x = parse(a),
    y = parse(b);
  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  }
  // A pre-release sorts before its release (1.0.0-beta < 1.0.0).
  if (x.pre && !y.pre) return -1;
  if (!x.pre && y.pre) return 1;
  return x.pre.localeCompare(y.pre, 'en', { numeric: true });
}

const isVersion = (v: string) => {
  const [core, pre] = v.trim().replace(/^v/, '').split('-', 2);
  const parts = core.split('.');
  return (
    parts.length >= 2 &&
    parts.length <= 3 &&
    parts.every((n) => /^\d+$/.test(n)) &&
    (pre === undefined || /^[\w.]+$/.test(pre))
  );
};

export function isManifest(value: unknown): value is ReleaseManifest {
  const m = value as ReleaseManifest;
  return (
    !!m &&
    typeof m.version === 'string' &&
    isVersion(m.version) &&
    typeof m.url === 'string' &&
    m.url.startsWith('https://')
  );
}

/** Where the check keeps its three settings; localStorage by default. */
export interface SettingsStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function localSettings(): SettingsStore {
  return {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* storage blocked: the check just runs again next time */
      }
    },
  };
}

const KEY = {
  auto: 'unsold.updates.auto',
  last: 'unsold.updates.lastCheck',
  skip: 'unsold.updates.skip',
};
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const autoCheckEnabled = (s: SettingsStore = localSettings()) =>
  s.get(KEY.auto) !== 'off';
export const setAutoCheck = (on: boolean, s: SettingsStore = localSettings()) =>
  s.set(KEY.auto, on ? 'on' : 'off');
/** "Not now" on a notice: stay quiet about this version (a newer one still shows). */
export const skipVersion = (
  version: string,
  s: SettingsStore = localSettings()
) => s.set(KEY.skip, version);

export type UpdateResult =
  | { status: 'available'; manifest: ReleaseManifest }
  | { status: 'current'; manifest: ReleaseManifest }
  | { status: 'skipped'; reason: 'store' | 'off' | 'recent' | 'dismissed' }
  | { status: 'error'; error: string };

/** A plain GET: no cookies, no referrer, no identifiers. */
export async function fetchManifest(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks the app's manifest for a newer version.
 * - `force` (the person clicked "Check for updates"): always asks, and shows
 *   a version even if they said "Not now" to it before.
 * - Otherwise (the quiet daily check): only if automatic checks are on, at
 *   most once a day, and never for store builds (the store updates those).
 */
export async function checkForUpdate(
  app: AppIdentity,
  {
    force = false,
    settings = localSettings(),
    now = Date.now(),
    getManifest = fetchManifest,
  }: {
    force?: boolean;
    settings?: SettingsStore;
    now?: number;
    getManifest?: (url: string) => Promise<unknown>;
  } = {}
): Promise<UpdateResult> {
  if (app.distribution === 'store')
    return { status: 'skipped', reason: 'store' };
  if (!force) {
    if (!autoCheckEnabled(settings))
      return { status: 'skipped', reason: 'off' };
    // Never checked: no limit yet.
    const last = Number(settings.get(KEY.last) ?? -Infinity);
    if (now - last < CHECK_INTERVAL_MS)
      return { status: 'skipped', reason: 'recent' };
  }
  // Recorded before asking, so a failing server isn't asked again all day.
  settings.set(KEY.last, String(now));
  let manifest: unknown;
  try {
    manifest = await getManifest(app.manifestUrl);
  } catch (e) {
    return {
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    };
  }
  if (!isManifest(manifest))
    return { status: 'error', error: 'Unexpected release file' };
  if (compareVersions(manifest.version, app.version) <= 0)
    return { status: 'current', manifest };
  if (!force && settings.get(KEY.skip) === manifest.version)
    return { status: 'skipped', reason: 'dismissed' };
  return { status: 'available', manifest };
}
