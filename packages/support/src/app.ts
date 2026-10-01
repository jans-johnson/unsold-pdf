/** Where the app came from decides how it updates. */
export type Distribution =
  /** Downloaded from our website: we tell people about new versions. */
  | 'direct'
  /** App Store / Google Play: the store updates it, so we stay quiet. */
  | 'store'
  /** The web version: a reload picks up the new version. */
  | 'web';

/** What an app tells the support package about itself. */
export interface AppIdentity {
  /** "Unsold PDF" */
  name: string;
  /** Semver of this build, e.g. "0.1.0". */
  version: string;
  /** Build id (short commit hash), or "dev". */
  build: string;
  distribution: Distribution;
  /** "owner/repo" on GitHub, where issues are filed. */
  repo: string;
  /** Address for emailed reports. */
  email: string;
  /** The app's release manifest, e.g. https://pdf.stayunsold.com/releases/latest.json */
  manifestUrl: string;
}
