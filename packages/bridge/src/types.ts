/**
 * The contract between UnAcrobat's UI and the operating system.
 *
 * UI code never talks to Tauri (or any other host) directly: it receives a
 * `HostBridge` and calls these methods. That keeps the Studio runnable in a
 * plain browser for development and tests, and keeps platform differences
 * (paths on desktop, content URIs on Android, security-scoped URLs on iOS)
 * behind one interface.
 */

export type Platform =
  | 'macos'
  | 'windows'
  | 'linux'
  | 'android'
  | 'ios'
  | 'web';

/**
 * Opaque reference to a file the host has granted access to: an absolute path
 * on desktop, a content/file URI on mobile. UI code only stores and passes it
 * back; it never parses it.
 */
export type FileHandle = string;

export interface DocumentRef {
  handle: FileHandle;
  name: string;
  size: number;
}

export interface OpenedDocument {
  /** `null` for files that have no location yet (drops, tool results). */
  handle: FileHandle | null;
  name: string;
  data: Uint8Array;
}

export interface RecentDocument extends DocumentRef {
  openedAt: number;
  exists: boolean;
}

export interface SavedDocument {
  handle: FileHandle;
  name: string;
}

export interface HostCapabilities {
  /** Reveal a file in Finder / Explorer / the file manager. */
  revealFile: boolean;
  /** Native application menu drives `onCommand`. */
  nativeMenu: boolean;
  /** Saving back to the file that was opened (vs. always "save a copy"). */
  saveInPlace: boolean;
}

/** Commands the host can ask the UI to run (menus, OS shortcuts). */
export interface HostCommand {
  command: string;
  arg?: string | number;
}

export interface NetRequest {
  url: string;
  method: 'GET' | 'POST';
  contentType?: string;
  body?: Uint8Array;
}

export interface NetResponse {
  status: number;
  contentType: string;
  body: Uint8Array;
}

export type Unsubscribe = () => void;

export interface HostBridge {
  readonly platform: Platform;
  readonly capabilities: HostCapabilities;

  /** Show the system picker; resolves with the documents the user chose. */
  pickDocuments(): Promise<OpenedDocument[]>;
  /** Re-open a document from the recents list. */
  openRecent(handle: FileHandle): Promise<OpenedDocument | null>;
  /** Overwrite a document the user opened or saved earlier. */
  save(handle: FileHandle, data: Uint8Array): Promise<void>;
  /** Ask where to save a PDF; `null` if the user cancelled. */
  saveAs(
    suggestedName: string,
    data: Uint8Array
  ): Promise<SavedDocument | null>;
  /** Save a non-document output (ZIP, image, DOCX…); resolves with its name or `null`. */
  exportFile(suggestedName: string, data: Uint8Array): Promise<string | null>;

  listRecents(): Promise<RecentDocument[]>;
  removeRecent(handle: FileHandle): Promise<void>;
  clearRecents(): Promise<void>;

  revealFile(handle: FileHandle): Promise<void>;
  openExternal(url: string): Promise<void>;
  setTitle(title: string): Promise<void>;

  /**
   * Fetch a certificate or timestamp resource that lacks CORS headers.
   * Hosts restrict this to public http(s) endpoints.
   */
  fetch(request: NetRequest): Promise<NetResponse>;

  /** Documents opened from outside the app ("Open with", file associations). */
  onDocumentsOpened(listener: (docs: OpenedDocument[]) => void): Unsubscribe;
  onCommand(listener: (command: HostCommand) => void): Unsubscribe;
  /**
   * Called when the window or app is about to close. Resolve `true` to let it
   * close, `false` to keep it open (e.g. the user cancelled a save prompt).
   */
  onCloseRequested(guard: () => Promise<boolean>): Unsubscribe;

  /** Tell the host the UI is ready to receive queued documents and commands. */
  ready(): Promise<void>;
}
