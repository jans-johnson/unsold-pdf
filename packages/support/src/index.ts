/**
 * Support for every Unsold app: "Report a problem" and "A new version is
 * available". Framework-free, so any Unsold app can use it; the app supplies
 * its own dialogs. The rules it follows are in Utility Apps/unsold/DESIGN.md
 * (§8, "Every app must have").
 *
 * Privacy: nothing here sends anything by itself. A report is only shown to
 * the person, who sends it themselves (email or GitHub). The update check is
 * one plain GET for a public file, carrying no identifiers, at most once a
 * day, and can be switched off.
 */

export * from './app.ts';
export * from './diagnostics.ts';
export * from './errors.ts';
export * from './report.ts';
export * from './updates.ts';
