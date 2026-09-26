import '@phosphor-icons/web/regular';
import '@phosphor-icons/web/fill';
import './styles.css';

import { connectHost, TOOL_HOST_KEY, type ToolHost } from '@unacrobat/bridge';
import { $ } from './dom.ts';
import type { PanelName } from './panels.ts';
import { Studio } from './studio.ts';
import { mountDocumentPanes, mountHome, mountToolsView } from './views.ts';

const host = await connectHost();
document.documentElement.dataset.platform = host.platform;
const studio = new Studio(host);

// Tool pages (same-origin frames) reach the Studio through window.unacrobat.
const toolHost: ToolHost = {
  deliverOutput: (output, source) => studio.receiveOutput(output, source),
  fetch: (request) => host.fetch(request),
  requestClose: (source) => studio.requestCloseFrom(source),
};
Object.assign(window, { [TOOL_HOST_KEY]: toolHost });

// ------------------------------------------------------------------ commands

type Command = (arg?: string | number, el?: HTMLElement) => void;

const commands: Record<string, Command> = {
  open: async () => studio.openFiles(await host.pickDocuments()),
  'toggle-left': () => studio.toggleLeftPane(),
  save: () => void studio.save(studio.activeDoc()),
  'save-as': () => void studio.save(studio.activeDoc(), { as: true }),
  revert: () => studio.revert(),
  print: () => studio.print(),
  undo: () => studio.undo(),
  redo: () => studio.redo(),
  'prev-page': () => studio.activeDoc()?.viewer?.pdfViewer.previousPage(),
  'next-page': () => studio.activeDoc()?.viewer?.pdfViewer.nextPage(),
  'zoom-in': () => studio.zoom('in'),
  'zoom-out': () => studio.zoom('out'),
  zoom: (v) => studio.zoom(v ?? 'auto'),
  'rotate-cw': () => studio.rotate(90),
  'rotate-ccw': () => studio.rotate(-90),
  rotate: (d) => studio.rotate(Number(d)),
  spread: (mode) => studio.spread(mode as string | undefined),
  find: () => {
    const doc = studio.activeDoc();
    if (doc && !doc.tool) $<HTMLInputElement>('#find-input').select();
  },
  'find-next': () => studio.find(true, false),
  'find-prev': () => studio.find(true, true),
  'share-export': (_, el) => el && studio.exportMenu(el),
  'close-panel': () => studio.togglePanel(studio.panel),
  panel: (name) => studio.togglePanel(name as PanelName),
  'close-tab': () => {
    const tab = studio.activeTab();
    if (tab) void studio.closeTab(tab);
  },
  reveal: () => {
    const handle = studio.activeDoc()?.handle;
    if (handle && host.capabilities.revealFile) void host.revealFile(handle);
  },
  properties: () => {
    if (!studio.activeDoc()) return;
    studio.panel = 'properties';
    studio.syncChrome();
  },
  home: () => studio.activate('home'),
  'all-tools': () => studio.activate('tools'),
  'open-tool': (id) => studio.openToolTab(String(id)),
  'run-tool': (id) => studio.runTool(String(id)),
};

document.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('[data-cmd]');
  if (btn && !btn.disabled) commands[btn.dataset.cmd!]?.(undefined, btn);
});
host.onCommand(({ command, arg }) => commands[command]?.(arg));
host.onDocumentsOpened((docs) => studio.openFiles(docs));
host.onCloseRequested(() => studio.confirmCloseAll());

// ------------------------------------------------------------------ drag & drop
// Drops over a tool's own frame go to the tool; drops elsewhere open files.

let dragDepth = 0;
const hasFiles = (e: DragEvent) =>
  [...(e.dataTransfer?.types ?? [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  $('#drop-overlay').hidden = false;
});
document.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $('#drop-overlay').hidden = true;
  }
});
document.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').hidden = true;
  const files = [...(e.dataTransfer?.files ?? [])];
  studio.openFiles(
    await Promise.all(
      files.map(async (f) => ({
        handle: null,
        name: f.name,
        data: new Uint8Array(await f.arrayBuffer()),
      }))
    )
  );
});

// ------------------------------------------------------------------ toolbar & keyboard

document
  .querySelectorAll<HTMLElement>('#tabstrip .tab.fixed')
  .forEach((b) =>
    b.addEventListener('click', () => studio.activate(b.dataset.tab!))
  );
document
  .querySelectorAll<HTMLElement>('#right-rail .rail-btn')
  .forEach((b) =>
    b.addEventListener('click', () =>
      studio.togglePanel(b.dataset.panel as PanelName)
    )
  );

const pageInput = $<HTMLInputElement>('#page-input');
pageInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const v = studio.activeDoc()?.viewer?.pdfViewer;
  const n = parseInt(pageInput.value, 10);
  if (v && n >= 1 && n <= v.pagesCount) v.currentPageNumber = n;
  pageInput.blur();
});
pageInput.addEventListener('blur', () => studio.syncPageUI());

const zoomSelect = $<HTMLSelectElement>('#zoom-select');
zoomSelect.addEventListener('change', () => {
  if (zoomSelect.value !== 'custom') studio.zoom(zoomSelect.value);
});

const findInput = $<HTMLInputElement>('#find-input');
let findTimer: ReturnType<typeof setTimeout> | undefined;
findInput.addEventListener('input', () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(() => studio.find(false), 200);
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') studio.find(true, e.shiftKey);
  if (e.key === 'Escape') {
    findInput.value = '';
    studio.find(false);
    findInput.blur();
  }
});

// Page navigation when the viewer (not a text field) has focus.
document.addEventListener('keydown', (e) => {
  const doc = studio.activeDoc();
  if (!doc?.viewer || doc.tool || e.metaKey || e.ctrlKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? ''))
    return;
  const v = doc.viewer.pdfViewer;
  const keys: Record<string, () => void> = {
    ArrowRight: () => v.nextPage(),
    PageDown: () => v.nextPage(),
    ArrowLeft: () => v.previousPage(),
    PageUp: () => v.previousPage(),
    Home: () => (v.currentPageNumber = 1),
    End: () => (v.currentPageNumber = v.pagesCount),
  };
  if (keys[e.key]) {
    keys[e.key]();
    e.preventDefault();
  }
});

// Pinch / Ctrl-scroll zoom in the viewer.
$('#stage').addEventListener(
  'wheel',
  (e) => {
    const doc = studio.activeDoc();
    const v = doc?.viewer?.pdfViewer;
    if (!v || !(e.ctrlKey || e.metaKey) || doc.tool) return;
    e.preventDefault();
    v.updateScale({
      steps: e.deltaY < 0 ? 1 : -1,
      origin: [e.clientX, e.clientY],
    });
  },
  { passive: false }
);

// ------------------------------------------------------------------ start

mountHome(studio);
mountToolsView(studio);
mountDocumentPanes(studio);
studio.activate('home');
await host.ready();

if (host.selfTest) {
  const { runSelfTest } = await import('./self-test.ts');
  await runSelfTest(studio, host.selfTest);
}
