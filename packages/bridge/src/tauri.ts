import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type {
  DocumentRef,
  HostBridge,
  HostCommand,
  OpenedDocument,
  Platform,
  RecentDocument,
  SavedDocument,
} from './types.ts';

interface HostInfo {
  platform: Platform;
  selfTest: boolean;
  tips: boolean;
  store: boolean;
}

// Header values must be ASCII; file names and paths often aren't.
const header = (value: string) => encodeURIComponent(value);

const toBytes = (buf: ArrayBuffer | Uint8Array) =>
  buf instanceof Uint8Array ? buf : new Uint8Array(buf);

async function read(ref: DocumentRef): Promise<OpenedDocument> {
  const data = await invoke<ArrayBuffer>('read_document', {
    handle: ref.handle,
  });
  return { handle: ref.handle, name: ref.name, data: toBytes(data) };
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Host backed by the Rust side in `native/src`. */
export async function createTauriBridge(): Promise<HostBridge> {
  const info = await invoke<HostInfo>('host_info');
  const desktop = !['android', 'ios'].includes(info.platform);
  const win = getCurrentWindow();
  // Android's WebView has no custom-protocol IPC, so byte payloads would
  // arrive as JSON number arrays; send base64 there instead.
  const body = (data: Uint8Array) =>
    info.platform === 'android' ? { b64: encodeBase64(data) } : data;

  const bridge: HostBridge = {
    platform: info.platform,
    capabilities: {
      revealFile: desktop,
      nativeMenu: desktop,
      saveInPlace: true,
      tips: info.tips,
      distribution: info.store ? 'store' : 'direct',
    },
    selfTest: info.selfTest
      ? { report: (checks) => invoke('self_test_report', { checks }) }
      : undefined,

    async pickDocuments() {
      const refs = await invoke<DocumentRef[]>('pick_documents');
      return Promise.all(refs.map(read));
    },
    async openRecent(handle) {
      const ref = await invoke<DocumentRef | null>('open_recent', { handle });
      return ref ? read(ref) : null;
    },
    async save(handle, data) {
      await invoke('save_document', body(data), {
        headers: { 'x-handle': header(handle) },
      });
    },
    saveAs(suggestedName, data) {
      return invoke<SavedDocument | null>('save_document_as', body(data), {
        headers: { 'x-name': header(suggestedName) },
      });
    },
    exportFile(suggestedName, data) {
      return invoke<string | null>('export_file', body(data), {
        headers: { 'x-name': header(suggestedName) },
      });
    },

    listRecents: () => invoke<RecentDocument[]>('recents_list'),
    removeRecent: (handle) => invoke('recents_remove', { handle }),
    clearRecents: () => invoke('recents_clear'),

    revealFile: (handle) => invoke('reveal_file', { handle }),
    openExternal: (url) => invoke('open_external', { url }),
    setTitle: (title) => win.setTitle(title),

    async fetch(req) {
      const res = await invoke<{
        status: number;
        contentType: string;
        body: string;
      }>('net_fetch', body(req.body ?? new Uint8Array()), {
        headers: {
          'x-url': header(req.url),
          'x-method': req.method,
          ...(req.contentType
            ? { 'x-content-type': header(req.contentType) }
            : {}),
        },
      });
      return {
        status: res.status,
        contentType: res.contentType,
        body: decodeBase64(res.body),
      };
    },

    onDocumentsOpened(listener) {
      const off = listen<DocumentRef[]>('documents-opened', async (e) => {
        listener(await Promise.all(e.payload.map(read)));
      });
      return () => void off.then((f) => f());
    },
    onCommand(listener) {
      const off = listen<HostCommand>('host-command', (e) =>
        listener(e.payload)
      );
      return () => void off.then((f) => f());
    },
    onCloseRequested(guard) {
      // Window close button / Cmd+W on the last window.
      const offClose = win.onCloseRequested(async (event) => {
        event.preventDefault();
        if (await guard()) await win.destroy();
      });
      // Cmd+Q / app quit: the Rust side holds the exit until we answer.
      const offQuit = listen('quit-requested', async () => {
        if (await guard()) await invoke('quit_app');
      });
      return () => {
        void offClose.then((f) => f());
        void offQuit.then((f) => f());
      };
    },
    ready: () => invoke('host_ready'),
  };
  return bridge;
}
