/**
 * Remembers the last few errors the app hit, so a report can include them.
 * Kept in memory only (never stored or sent on its own), trimmed, and shown
 * to the person in full before they send anything.
 */

export interface RecordedError {
  at: string;
  message: string;
}

const MAX_ERRORS = 10;
const MAX_LENGTH = 300;
const errors: RecordedError[] = [];

export function recordError(message: unknown) {
  const text = String(
    message instanceof Error ? `${message.name}: ${message.message}` : message
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LENGTH);
  if (!text) return;
  // Repeats of the same error add nothing.
  if (errors.at(-1)?.message === text) return;
  errors.push({ at: new Date().toISOString(), message: text });
  if (errors.length > MAX_ERRORS) errors.shift();
}

export const recentErrors = (): readonly RecordedError[] => errors;

/** Start recording uncaught errors and rejections. Call once, early. */
export function captureErrors(target: Window = window) {
  target.addEventListener('error', (e) => recordError(e.error ?? e.message));
  target.addEventListener('unhandledrejection', (e) => recordError(e.reason));
}
