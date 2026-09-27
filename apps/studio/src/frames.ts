import { h, icon } from './dom.ts';
import { hasTool, tool } from './catalog.ts';

export interface FrameFile {
  name: string;
  data: Uint8Array;
  /** The tool works on just this file: hide its own upload step. */
  only?: boolean;
  /** Password the user already unlocked it with (tools use it instead of asking). */
  password?: string;
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
  /* The Studio header already names the task and mode. */
  h1[data-i18n^="tools:"],
  p[data-i18n^="tools:"][data-i18n$=".subtitle"],
  h1:has(~ #drop-zone),
  h1:has(~ #drop-zone) + p { display: none !important; }
  /* The open document was handed in: no upload step for single-file tools. */
  html.ua-doc-loaded #drop-zone,
  html.ua-doc-loaded #file-display-area { display: none !important; }
  /* "Change file" would lead back to that hidden upload step. */
  html.ua-doc-loaded #editor-back-btn { display: none !important; }
  /* Tools whose editor sits after the upload card (e.g. Sign) would be left
     with an empty card; hide it when nothing else in it is showing. */
  html.ua-doc-loaded #tool-uploader:not(:has(> :not(#back-to-tools, h1, h1 + p, #drop-zone, #file-display-area))) {
    display: none !important;
  }
  html.ua-doc-loaded #tool-uploader:not(:has(> :not(#back-to-tools, h1, h1 + p, #drop-zone, #file-display-area))) + * {
    margin-top: 0 !important;
  }
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

/**
 * Many tool pages clear their file list after a successful run (or on "Clear
 * all"), which inside a document tab leaves an empty panel with no way to
 * add the file back. When that happens, hand the document in again.
 */
function refeedWhenCleared(iframe: HTMLIFrameElement, file: FrameFile) {
  const win = iframe.contentWindow as (Window & typeof globalThis) | null;
  const doc = iframe.contentDocument;
  const area =
    doc?.getElementById('file-display-area') ?? doc?.getElementById('fileList');
  if (!win || !area) return;
  let had = area.childElementCount > 0;
  const watch = new win.MutationObserver(() => {
    if (area.childElementCount > 0) had = true;
    else if (had) {
      watch.disconnect();
      setTimeout(() => void injectFile(iframe, file), 300);
    }
  });
  watch.observe(area, { childList: true });
}

/** Whether a file input's `accept` names this file's extension or type. */
function accepts(input: HTMLInputElement, name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return input.accept
    .toLowerCase()
    .split(',')
    .map((a) => a.trim())
    .some(
      (a) =>
        a === `.${ext}` || a === `application/${ext}` || a === `text/${ext}`
    );
}

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
      candidates.find((i) => accepts(i, file.name)) ??
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
    if (file.password) {
      (win as Window & { __unsoldPassword?: string }).__unsoldPassword =
        file.password;
    }
    input.files = dt.files;
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
    if (file.only) {
      iframe.contentDocument?.documentElement.classList.add('ua-doc-loaded');
      refeedWhenCleared(iframe, file);
    }
  } catch (err) {
    console.warn('File injection failed', err);
  }
}

/**
 * Create PDF's "from files" mode: one place to drop or pick any supported
 * file; each file is routed to the right converter.
 */
export function mountCreatePanel(
  wrap: HTMLElement,
  opts: { pick: () => void; formats: string[] }
) {
  wrap.replaceChildren(
    h(
      'div',
      { class: 'create-panel' },
      h(
        'div',
        { class: 'create-drop' },
        icon('ph-file-arrow-up', 'ph create-icon'),
        h('h2', {}, 'Turn files into a PDF'),
        h(
          'p',
          { class: 'muted' },
          'Drop files anywhere in this window, or choose them. Each file is converted with the right tool automatically.'
        ),
        h(
          'button',
          { class: 'btn primary lg', onclick: opts.pick },
          icon('ph-folder-open'),
          'Choose files'
        )
      ),
      h(
        'div',
        { class: 'create-formats' },
        h('h3', {}, 'Works with'),
        h(
          'div',
          { class: 'chips' },
          ['Images', ...opts.formats].map((f) =>
            h('span', { class: 'chip' }, f)
          )
        )
      )
    )
  );
}
