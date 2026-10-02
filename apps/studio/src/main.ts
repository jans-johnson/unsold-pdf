import '@phosphor-icons/web/regular';
import '@phosphor-icons/web/fill';
import './styles.css';

import { connectHost, TOOL_HOST_KEY, type ToolHost } from '@unsold/bridge';
import { captureErrors } from '@unsold/support';
import { $ } from './dom.ts';
import type { PanelName } from './panels.ts';
import { Studio } from './studio.ts';
import { closeMenus } from './ui/feedback.ts';
import { mountDefaultAppCard } from './default-app.ts';
import { mountSimple, setMode, simpleShown } from './simple.ts';
import {
  openAboutDialog,
  openReportDialog,
  scheduleUpdateCheck,
} from './support.ts';
import { mountDocumentPanes, mountHome, mountToolsView } from './views.ts';

// First, so a problem report can include errors from start-up onwards.
captureErrors();

const host = await connectHost();
document.documentElement.dataset.platform = host.platform;

// The web version needs its service worker for cross-origin isolation; a
// direct visit to /studio/ before it's installed goes via the start page.
if (host.platform === 'web' && !crossOriginIsolated && !import.meta.env.DEV) {
  location.replace('../');
}
const studio = new Studio(host);

// Tool pages (same-origin frames) reach the Studio through window.unsold.
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
  // Phones: the find box opens over the toolbar.
  'find-open': () => {
    $('#doc-toolbar').classList.add('finding');
    $<HTMLInputElement>('#find-input').focus();
  },
  'find-close': () => {
    $('#doc-toolbar').classList.remove('finding');
    $<HTMLInputElement>('#find-input').value = '';
    studio.find(false);
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
  'report-problem': () => void openReportDialog(studio),
  about: () => void openAboutDialog(studio),
  'simple-mode': () => {
    setMode('simple');
    studio.activate(studio.active);
  },
  'check-updates': () => void openAboutDialog(studio),
};

document.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>('[data-cmd]');
  if (btn && !btn.disabled) commands[btn.dataset.cmd!]?.(undefined, btn);
});
host.onCommand(({ command, arg }) => commands[command]?.(arg));

// Android's back gesture asks here first (MainActivity): close what's on top
// and say so, or return false at Home to let the system take it.
Object.assign(window, {
  __unsoldBack: (): boolean => {
    if (document.querySelector('.menu-pop')) {
      closeMenus();
      return true;
    }
    const backdrop = document.querySelector('.modal-backdrop');
    if (backdrop) {
      backdrop.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
      return true;
    }
    if ($('#doc-toolbar').classList.contains('finding')) {
      commands['find-close']();
      return true;
    }
    const tab = studio.activeTab();
    if (tab?.kind === 'doc' && studio.panel) {
      studio.togglePanel(null);
      return true;
    }
    if (tab?.kind === 'doc' && tab.tool) {
      void studio.requestCloseTool(tab);
      return true;
    }
    if (tab) {
      // Simple mode closes the document (as phone PDF apps do); power mode
      // keeps it open in its tab and goes Home.
      if (simpleShown()) void studio.closeTab(tab);
      else studio.activate('home');
      return true;
    }
    if (studio.active !== 'home') {
      studio.activate('home');
      return true;
    }
    return false;
  },
});
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

// Two-finger pinch zoom in the viewer (the page itself doesn't zoom).
let pinch: { dist: number; scale: number } | null = null;
const spread = (t: TouchList) =>
  Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
$('#stage').addEventListener(
  'touchstart',
  (e) => {
    const v = studio.activeDoc()?.viewer?.pdfViewer;
    pinch =
      v && e.touches.length === 2
        ? { dist: spread(e.touches), scale: v.currentScale }
        : null;
  },
  { passive: true }
);
$('#stage').addEventListener(
  'touchmove',
  (e) => {
    const doc = studio.activeDoc();
    const v = doc?.viewer?.pdfViewer;
    if (!pinch || !v || doc.tool || e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = [e.touches[0], e.touches[1]];
    const target = (pinch.scale * spread(e.touches)) / pinch.dist;
    v.updateScale({
      scaleFactor: target / v.currentScale,
      origin: [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2],
      drawingDelay: 250,
    });
  },
  { passive: false }
);
$('#stage').addEventListener('touchend', (e) => {
  if (e.touches.length < 2) pinch = null;
});

// ------------------------------------------------------------------ start

mountHome(studio);
mountSimple(studio);
void mountDefaultAppCard(studio);
mountToolsView(studio);
mountDocumentPanes(studio);
studio.activate('home');
await host.ready();
scheduleUpdateCheck(studio);

if (host.selfTest) {
  const { runSelfTest } = await import('./self-test.ts');
  await runSelfTest(studio, host.selfTest);
}
