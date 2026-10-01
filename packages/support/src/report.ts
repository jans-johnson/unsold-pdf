import type { AppIdentity } from './app.ts';
import type { Diagnostic } from './diagnostics.ts';

/**
 * A problem report: the person's words plus the diagnostics they were shown.
 * Plain text that reads well in an email; GitHub gets the diagnostics in a
 * code block so the layout survives.
 */
export function formatReport(
  description: string,
  diagnostics: Diagnostic[],
  { markdown = false } = {}
): string {
  const words = description.trim() || '(no description)';
  const facts = diagnostics
    .map(([label, value]) =>
      value.includes('\n')
        ? `${label}:\n${value.replace(/^/gm, '  ')}`
        : `${label}: ${value}`
    )
    .join('\n');
  return markdown
    ? `### What happened\n\n${words}\n\n### About this app and device\n\n\`\`\`\n${facts}\n\`\`\`\n`
    : `What happened:\n${words}\n\n--- About this app and device ---\n${facts}\n`;
}

/** A short title from the first line of what the person wrote. */
export function reportTitle(app: AppIdentity, description: string): string {
  const first = description.trim().split('\n')[0]?.trim() ?? '';
  if (!first) return `${app.name} ${app.version}: problem report`;
  return first.length > 72 ? `${first.slice(0, 71)}…` : first;
}

const TRIM_NOTE =
  '\n\n[Report trimmed to fit. Use "Copy report" in the app for all of it.]';

/**
 * Shortens `body` until the encoded link fits. Browsers and mail apps reject
 * very long URLs (GitHub ~8 KB; some mail clients ~2 KB).
 */
export function fitBody(body: string, maxEncoded: number): string {
  if (encodeURIComponent(body).length <= maxEncoded) return body;
  let lo = 0,
    hi = body.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = body.slice(0, mid) + TRIM_NOTE;
    if (encodeURIComponent(candidate).length <= maxEncoded) lo = mid;
    else hi = mid - 1;
  }
  return body.slice(0, lo) + TRIM_NOTE;
}

export const GITHUB_URL_BUDGET = 7000;
export const MAILTO_URL_BUDGET = 1800;

/** Opens a new, pre-filled GitHub issue. The person reviews it and submits. */
export function githubIssueUrl(
  app: AppIdentity,
  title: string,
  body: string
): string {
  const params = new URLSearchParams({ title });
  const base = `https://github.com/${app.repo}/issues/new?${params}&body=`;
  return base + encodeURIComponent(fitBody(body, GITHUB_URL_BUDGET));
}

/** Opens the person's mail app with the report filled in. */
export function mailtoUrl(
  app: AppIdentity,
  subject: string,
  body: string
): string {
  return (
    `mailto:${app.email}?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(fitBody(body, MAILTO_URL_BUDGET))}`
  );
}
