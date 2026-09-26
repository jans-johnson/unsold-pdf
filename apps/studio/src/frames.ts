import { h } from './dom.ts';
import { hasTool, tool } from './catalog.ts';

export interface FrameFile {
  name: string;
  data: Uint8Array;
}

export interface FrameEvents {
  /** The page navigated back to the tool index: treat as "close tool". */
  onLeave(): void;
  /** An in-page link pointed at another tool. */
  onOpenTool(id: string): void;
}

// Tool pages are standalone web pages; inside the Studio their own chrome is
// hidden and the accent colour matches the app.
const FRAME_CSS = `
  nav[data-simple-nav], footer[data-simple-footer], #back-to-tools { display: none !important; }
  :root {
    --color-indigo-300: #8ec1ff; --color-indigo-400: #5aa4fb; --color-indigo-500: #3b8ff5;
    --color-indigo-600: #1a73e8; --color-indigo-700: #1565d0;
  }
  html, body { background: #222 !important; }
  #uploader { min-height: 100% !important; }
`;

const toolIdOf = (pathname: string) =>
  pathname
    .replace(/^\//, '')
    .replace(/\.html$/, '')
    .replace(/\/$/, '');

export function mountToolFrame(
  wrap: HTMLElement,
  toolId: string,
  file: FrameFile | undefined,
  events: FrameEvents
): HTMLIFrameElement {
  const loading = h(
    'div',
    { class: 'frame-loading' },
    h(
      'div',
      {},
      h('div', { class: 'spinner' }),
      `Loading ${tool(toolId)?.name ?? 'tool'}…`
    )
  );
  const iframe = h('iframe', {
    src: `/${toolId}.html`,
    allow: 'clipboard-read; clipboard-write',
  });
  wrap.replaceChildren(iframe, loading);
  let injected = false;

  iframe.addEventListener('load', () => {
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) return;
    const current = toolIdOf(win.location.pathname);
    if (current === '' || current === 'index') return events.onLeave();

    doc.head.append(
      Object.assign(doc.createElement('style'), { textContent: FRAME_CSS })
    );
    doc.addEventListener(
      'click',
      (e) => {
        const a = (e.target as Element | null)?.closest?.(
          'a[href]'
        ) as HTMLAnchorElement | null;
        if (!a || a.target === '_blank') return;
        const url = new URL(a.href, win.location.href);
        if (url.origin !== location.origin) return;
        const id = toolIdOf(url.pathname);
        if (id === '' || id === 'index') {
          e.preventDefault();
          events.onLeave();
        } else if (hasTool(id) && id !== toolId) {
          e.preventDefault();
          events.onOpenTool(id);
        }
      },
      true
    );

    loading.style.opacity = '0';
    setTimeout(() => loading.remove(), 250);
    if (file && !injected) {
      injected = true;
      void injectFile(iframe, file);
    }
  });
  return iframe;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Hands a document to the tool page's upload input, as if the user picked it. */
async function injectFile(iframe: HTMLIFrameElement, file: FrameFile) {
  const deadline = Date.now() + 8000;
  const win = iframe.contentWindow as (Window & typeof globalThis) | null;
  if (!win) return;
  let input: HTMLInputElement | undefined;
  while (Date.now() < deadline) {
    const candidates = [
      ...(iframe.contentDocument?.querySelectorAll<HTMLInputElement>(
        'input[type=file]'
      ) ?? []),
    ];
    input =
      candidates.find((i) => i.id === 'file-input') ??
      candidates.find((i) => /pdf/i.test(i.accept)) ??
      candidates.find((i) => !i.accept);
    if (input) break;
    await sleep(150);
  }
  if (!input) return;
  const accept = input.accept.toLowerCase();
  const isPdf = /\.pdf$/i.test(file.name);
  if (isPdf && accept && !/pdf|\*/.test(accept)) return;
  await sleep(250); // let the page finish wiring its listeners
  try {
    const dt = new win.DataTransfer();
    dt.items.add(
      new win.File([file.data as BlobPart], file.name, {
        type: isPdf ? 'application/pdf' : '',
      })
    );
    input.files = dt.files;
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
  } catch (err) {
    console.warn('File injection failed', err);
  }
}
