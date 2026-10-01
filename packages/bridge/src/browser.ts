import type {
  HostBridge,
  NetRequest,
  NetResponse,
  OpenedDocument,
} from './types.ts';

/**
 * Plain-browser host, used by `npm run dev` and tests. Files have no lasting
 * location, so saving always downloads a copy and there are no recents.
 */
export function createBrowserBridge(
  options: { proxyUrl?: string } = {}
): HostBridge {
  const proxyUrl = options.proxyUrl ?? '/cors-proxy';

  function download(name: string, data: Uint8Array) {
    const url = URL.createObjectURL(new Blob([data as BlobPart]));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: name,
    });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function pick(): Promise<OpenedDocument[]> {
    return new Promise((resolve) => {
      const input = Object.assign(document.createElement('input'), {
        type: 'file',
        multiple: true,
      });
      input.addEventListener('change', async () => {
        const files = [...(input.files ?? [])];
        resolve(
          await Promise.all(
            files.map(async (f) => ({
              handle: null,
              name: f.name,
              data: new Uint8Array(await f.arrayBuffer()),
            }))
          )
        );
      });
      input.addEventListener('cancel', () => resolve([]));
      input.click();
    });
  }

  return {
    platform: 'web',
    capabilities: {
      revealFile: false,
      nativeMenu: false,
      saveInPlace: false,
      tips: true,
      distribution: 'web',
    },

    pickDocuments: pick,
    openRecent: async () => null,
    save: async () => {
      throw new Error('Saving in place is not available in the browser');
    },
    saveAs: async (name, data) => {
      download(name, data);
      return null;
    },
    exportFile: async (name, data) => {
      download(name, data);
      return name;
    },

    listRecents: async () => [],
    removeRecent: async () => {},
    clearRecents: async () => {},

    revealFile: async () => {},
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener');
    },
    setTitle: async (title) => {
      document.title = title;
    },

    fetch: async (req: NetRequest): Promise<NetResponse> => {
      const res = await fetch(
        `${proxyUrl}?url=${encodeURIComponent(req.url)}`,
        {
          method: req.method,
          headers: req.contentType ? { 'Content-Type': req.contentType } : {},
          body: req.body as BodyInit | undefined,
        }
      );
      return {
        status: res.status,
        contentType:
          res.headers.get('content-type') ?? 'application/octet-stream',
        body: new Uint8Array(await res.arrayBuffer()),
      };
    },

    onDocumentsOpened: () => () => {},
    onCommand: () => () => {},
    // Browsers cannot await an async save prompt during unload, so the dev
    // host has no close guard.
    onCloseRequested: () => () => {},
    ready: async () => {},
  };
}
