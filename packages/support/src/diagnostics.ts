import type { AppIdentity } from './app.ts';
import { recentErrors } from './errors.ts';

/** One line of "what's in this report", shown to the person as-is. */
export type Diagnostic = [label: string, value: string];

/** Facts from the running environment; injectable so tests can fake them. */
export interface Environment {
  platform: string;
  userAgent: string;
  language: string;
  screen: string;
  /** Anything app-specific worth knowing (current view, engine versions…). */
  extra?: Diagnostic[];
}

export function browserEnvironment(
  platform: string,
  extra: Diagnostic[] = []
): Environment {
  const isolated =
    typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false;
  return {
    platform,
    userAgent: navigator.userAgent,
    language: navigator.language,
    screen: `${screen.width}×${screen.height} @${devicePixelRatio}x, window ${innerWidth}×${innerHeight}`,
    extra: [
      ['Cross-origin isolated', isolated ? 'yes' : 'no'],
      ['WASM threads', typeof SharedArrayBuffer === 'function' ? 'yes' : 'no'],
      ...extra,
    ],
  };
}

/** A readable OS name from a user agent, e.g. "macOS 10.15.7", "Android 14". */
export function describeOs(userAgent: string): string {
  const pick = (re: RegExp) => userAgent.match(re)?.[1]?.replace(/_/g, '.');
  const tests: [string, RegExp][] = [
    ['iOS', /(?:iPhone|iPad|iPod).*? OS (\d+[_.\d]*)/],
    ['Android', /Android (\d+[.\d]*)/],
    ['macOS', /Mac OS X (\d+[_.\d]*)/],
    ['Windows NT', /Windows NT (\d+[.\d]*)/],
    ['ChromeOS', /CrOS \S+ (\d+[.\d]*)/],
  ];
  for (const [name, re] of tests) {
    const v = pick(re);
    if (v) return `${name} ${v}`;
  }
  return /Linux/.test(userAgent) ? 'Linux' : 'unknown';
}

/** Everything a report includes, in the order it's shown. */
export function collectDiagnostics(
  app: AppIdentity,
  env: Environment
): Diagnostic[] {
  const lines: Diagnostic[] = [
    ['App', `${app.name} ${app.version} (build ${app.build})`],
    ['Installed from', distributionLabel(app.distribution)],
    ['Platform', env.platform],
    ['OS', describeOs(env.userAgent)],
    ['Language', env.language],
    ['Screen', env.screen],
    ...(env.extra ?? []),
    ['User agent', env.userAgent],
  ];
  const errors = recentErrors();
  lines.push([
    'Recent errors',
    errors.length
      ? errors.map((e) => `${e.at.slice(11, 19)} ${e.message}`).join('\n')
      : 'none',
  ]);
  return lines;
}

export const distributionLabel = (d: AppIdentity['distribution']) =>
  d === 'store' ? 'app store' : d === 'web' ? 'web version' : 'direct download';
