import { $, formatBytes, h, icon, locationOf } from './dom.ts';
import { pdfjs, type PdfDocument } from './pdf.ts';
import type { DocTab } from './tabs.ts';
import { toast } from './ui/feedback.ts';

export type PanelName =
  | 'thumbnails'
  | 'bookmarks'
  | 'attachments'
  | 'properties';

export const PANEL_TITLES: Record<PanelName, string> = {
  thumbnails: 'Page thumbnails',
  bookmarks: 'Bookmarks',
  attachments: 'Attachments',
  properties: 'Document properties',
};

export interface PanelActions {
  openAttachment(name: string, data: Uint8Array): void;
  exportAttachment(name: string, data: Uint8Array): void;
  runTool(tab: DocTab, toolId: string): void;
  reveal?(handle: string): void;
  openExternal(url: string): void;
}

interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  url: string | null;
  items: OutlineItem[];
}

let renderToken = 0;

export async function renderPanel(
  tab: DocTab,
  panel: PanelName,
  actions: PanelActions
) {
  const body = $('#side-body');
  const pdf = tab.pdfDoc;
  if (!pdf) return body.replaceChildren();
  $('#side-title').textContent = PANEL_TITLES[panel];
  const token = ++renderToken;
  const stale = () => token !== renderToken;

  if (panel === 'thumbnails') {
    if (!tab.thumbs || tab.thumbsDoc !== pdf) buildThumbs(tab, pdf);
    body.replaceChildren(tab.thumbs!);
    highlightThumb(tab, true);
  } else if (panel === 'bookmarks') {
    const outline = (await pdf.getOutline()) as OutlineItem[] | null;
    if (stale()) return;
    if (!outline?.length) {
      return body.replaceChildren(
        empty('ph-bookmark-simple', 'This document has no bookmarks')
      );
    }
    const build = (items: OutlineItem[]): HTMLElement =>
      h(
        'ul',
        { class: 'outline-list' },
        items.map((it) => {
          const li = h('li', { class: it.items?.length ? 'closed' : '' });
          li.append(
            h(
              'div',
              { class: 'outline-item' },
              h(
                'button',
                {
                  class: 'toggle',
                  onclick: () => li.classList.toggle('closed'),
                },
                it.items?.length ? icon('ph-caret-right') : ''
              ),
              h(
                'a',
                {
                  href: '#',
                  onclick: (e: Event) => {
                    e.preventDefault();
                    if (it.dest)
                      void tab.viewer?.linkService.goToDestination(it.dest);
                    else if (it.url) actions.openExternal(it.url);
                  },
                },
                it.title
              )
            )
          );
          if (it.items?.length) li.append(build(it.items));
          return li;
        })
      );
    body.replaceChildren(build(outline));
  } else if (panel === 'attachments') {
    const attachments = (await pdf.getAttachments()) as Record<
      string,
      { filename: string; content: Uint8Array }
    > | null;
    if (stale()) return;
    const list = Object.values(attachments ?? {});
    if (!list.length)
      return body.replaceChildren(empty('ph-paperclip', 'No attachments'));
    body.replaceChildren(
      ...list.map((a) =>
        h(
          'button',
          {
            class: 'attach-item',
            onclick: () =>
              /\.pdf$/i.test(a.filename)
                ? actions.openAttachment(a.filename, a.content)
                : actions.exportAttachment(a.filename, a.content),
          },
          icon('ph-file'),
          h('span', {}, a.filename),
          h(
            'span',
            { class: 'muted', style: 'margin-left:auto' },
            formatBytes(a.content.length)
          )
        )
      )
    );
  } else {
    const [{ info }, page1] = await Promise.all([
      pdf.getMetadata(),
      pdf.getPage(1),
    ]);
    if (stale()) return;
    const meta = info as Record<string, string | boolean | undefined>;
    const vp = page1.getViewport({ scale: 1 });
    const inches = (pt: number) => (pt / 72).toFixed(2);
    const date = (d: unknown) => {
      const dt =
        typeof d === 'string' ? pdfjs.PDFDateString.toDateObject(d) : null;
      return dt ? dt.toLocaleString() : '—';
    };
    const text = (k: string) => (meta[k] as string | undefined) || '—';
    const rows: [string, string | number][] = [
      ['File', tab.name],
      ['Location', locationOf(tab.handle) || (tab.handle ? '—' : 'Not saved')],
      ['Size', formatBytes(tab.bytes.length)],
      ['Pages', pdf.numPages],
      ['Page size', `${inches(vp.width)} × ${inches(vp.height)} in`],
      ['PDF version', text('PDFFormatVersion')],
      ['Title', text('Title')],
      ['Author', text('Author')],
      ['Subject', text('Subject')],
      ['Keywords', text('Keywords')],
      ['Creator', text('Creator')],
      ['Producer', text('Producer')],
      ['Created', date(meta.CreationDate)],
      ['Modified', date(meta.ModDate)],
      ['Tagged', meta.IsTagged ? 'Yes' : 'No'],
      ['Form fields', meta.IsAcroFormPresent ? 'Yes' : 'No'],
    ];
    body.replaceChildren(
      h(
        'table',
        { class: 'prop-table' },
        rows.map(([k, v]) =>
          h('tr', {}, h('th', {}, k), h('td', {}, String(v)))
        )
      ),
      h(
        'div',
        { style: 'margin-top:14px;display:flex;gap:8px;flex-wrap:wrap' },
        h(
          'button',
          {
            class: 'btn sm',
            onclick: () => actions.runTool(tab, 'edit-metadata'),
          },
          icon('ph-pencil-simple'),
          'Edit metadata'
        ),
        tab.handle && actions.reveal
          ? h(
              'button',
              { class: 'btn sm', onclick: () => actions.reveal!(tab.handle!) },
              icon('ph-folder'),
              'Show in folder'
            )
          : null
      )
    );
  }
}

const empty = (ic: string, text: string) =>
  h('div', { class: 'empty' }, icon(ic), text);

function buildThumbs(tab: DocTab, pdf: PdfDocument) {
  tab.thumbsDoc = pdf;
  const wrap = h('div', { class: 'thumbs' });
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (!e.isIntersecting || el.dataset.rendered) continue;
        el.dataset.rendered = '1';
        void renderThumb(
          pdf,
          Number(el.dataset.page),
          el.querySelector<HTMLElement>('.thumb-page')!
        );
      }
    },
    { root: $('#side-body'), rootMargin: '400px' }
  );
  for (let i = 1; i <= pdf.numPages; i++) {
    const el = h(
      'div',
      {
        class: 'thumb',
        dataset: { page: i },
        onclick: () => {
          if (tab.viewer) tab.viewer.pdfViewer.currentPageNumber = i;
        },
      },
      h('div', { class: 'thumb-page', style: 'height:168px' }),
      h('span', {}, i)
    );
    wrap.append(el);
    observer.observe(el);
  }
  tab.thumbs = wrap;
}

async function renderThumb(pdf: PdfDocument, n: number, box: HTMLElement) {
  try {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = (130 / base.width) * (window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale });
    const canvas = h('canvas', {
      width: Math.floor(vp.width),
      height: Math.floor(vp.height),
    });
    box.style.height = `${(130 * base.height) / base.width}px`;
    await page.render({
      canvas,
      canvasContext: canvas.getContext('2d')!,
      viewport: vp,
    }).promise;
    box.replaceChildren(canvas);
  } catch {
    /* the document was replaced while rendering */
  }
}

export function highlightThumb(tab: DocTab, scroll = false) {
  if (!tab.thumbs) return;
  const n = tab.viewer?.pdfViewer.currentPageNumber;
  tab.thumbs
    .querySelectorAll('.thumb.current')
    .forEach((t) => t.classList.remove('current'));
  const cur = tab.thumbs.querySelector(`.thumb[data-page="${n}"]`);
  if (cur) {
    cur.classList.add('current');
    cur.scrollIntoView({
      block: 'nearest',
      behavior: scroll ? 'auto' : 'smooth',
    });
  }
}

/** Renders every page to an image and opens the system print dialog. */
export async function printDocument(
  pdf: PdfDocument,
  onStart: (pages: number) => void
) {
  const root = $('#print-root');
  onStart(pdf.numPages);
  const urls: string[] = [];
  const imgs: HTMLImageElement[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 150 / 72 });
    const canvas = h('canvas', {
      width: Math.floor(vp.width),
      height: Math.floor(vp.height),
    });
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvas,
      canvasContext: ctx,
      viewport: vp,
      intent: 'print',
      annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE,
    }).promise;
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, 'image/png')
    );
    if (!blob) continue;
    const url = URL.createObjectURL(blob);
    urls.push(url);
    imgs.push(h('img', { src: url }));
  }
  root.replaceChildren(...imgs);
  await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
  try {
    // In the native app window.print() is async (it goes through Tauri), so
    // keep the pages in place until it has returned.
    await Promise.resolve(window.print() as unknown);
  } catch (err) {
    console.error('Print failed', err);
    toast('Couldn’t open the print dialog');
  } finally {
    root.replaceChildren();
    urls.forEach((u) => URL.revokeObjectURL(u));
  }
}
