// UnAcrobat desktop shell – Acrobat-style workspace around the UnAcrobat tools.
// Served from app://unacrobat/__shell/, so it is same-origin with every tool
// page and can hand the open document straight into a tool's file input.

import '/pdfjs-viewer/pdf.mjs';

const pdfjsLib = globalThis.pdfjsLib;
const { EventBus, PDFViewer, PDFLinkService, PDFFindController, LinkTarget } =
  await import('/pdfjs-viewer/pdf_viewer.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs-viewer/pdf.worker.mjs';

const DOC_OPTS = {
  cMapUrl: '/pdfjs-viewer/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs-viewer/standard_fonts/',
  wasmUrl: '/pdfjs-viewer/wasm/',
  iccUrl: '/pdfjs-viewer/iccs/',
};

const desktop = window.desktop;
const CATEGORIES = await (await fetch('generated/tools.json')).json();

// ---------------------------------------------------------------- catalog

const CAT_STYLE = {
  'Edit & Annotate': { color: '#c93f9b', icon: 'ph-pencil-simple-line' },
  'Convert to PDF': { color: '#e36a1f', icon: 'ph-file-plus' },
  'Convert from PDF': { color: '#1f9e74', icon: 'ph-export' },
  'Organize & Manage': { color: '#2f7fe6', icon: 'ph-files' },
  'Optimize & Repair': { color: '#7b5ce6', icon: 'ph-wrench' },
  'Secure PDF': { color: '#c2861a', icon: 'ph-shield-check' },
};
const POPULAR = 'Popular Tools';

const TOOLS = new Map(); // id -> {id, name, icon, subtitle, category, color}
for (const cat of CATEGORIES) {
  if (cat.name === POPULAR) continue;
  for (const t of cat.tools) {
    if (!TOOLS.has(t.id)) {
      TOOLS.set(t.id, { ...t, category: cat.name, color: CAT_STYLE[cat.name]?.color || '#555' });
    }
  }
}
for (const t of CATEGORIES.find((c) => c.name === POPULAR)?.tools || []) {
  if (!TOOLS.has(t.id)) TOOLS.set(t.id, { ...t, category: POPULAR, color: '#e34850' });
}
// Pages that exist but are not in the catalog.
TOOLS.set('wasm-settings', {
  id: 'wasm-settings',
  name: 'Engine Settings',
  icon: 'ph-gear',
  subtitle: 'Configure the PyMuPDF, Ghostscript and CPDF engines.',
  category: 'Settings',
  color: '#555',
});

const tool = (id) => TOOLS.get(id);

// Tools whose output should open as a new document instead of replacing the
// document the tool was run on.
const NEW_DOC_TOOLS = new Set([
  'merge-pdf',
  'alternate-merge',
  'split-pdf',
  'extract-pages',
  'compare-pdfs',
  'duplex-collate',
  'pdf-to-pdfa',
]);
// Tools that do not take the current PDF as input.
const NO_PDF_INPUT = new Set(['pdf-workflow', 'markdown-to-pdf', 'wasm-settings']);
const takesPdf = (id) =>
  !NO_PDF_INPUT.has(id) && tool(id)?.category !== 'Convert to PDF';

const RECOMMENDED = [
  ['edit-pdf', 'Comment & annotate', 'ph-chat-circle-text'],
  ['edit-pdf-text', 'Edit text', 'ph-cursor-text'],
  ['pdf-to-word', 'Export a PDF', 'ph-export'],
  ['word-to-pdf', 'Create a PDF', 'ph-file-plus'],
  ['merge-pdf', 'Combine files', 'ph-browsers'],
  ['organize-pdf', 'Organize pages', 'ph-files'],
  ['sign-pdf', 'Fill & Sign', 'ph-pen-nib'],
  ['compress-pdf', 'Compress a PDF', 'ph-arrows-in'],
  ['ocr-pdf', 'Scan & OCR', 'ph-scan'],
  ['protect-pdf', 'Protect a PDF', 'ph-lock-key'],
];

const QUICK_RAIL = [
  ['edit-pdf', 'Comment & annotate', 'ph-chat-circle-text'],
  ['edit-pdf-text', 'Edit text & images', 'ph-cursor-text'],
  ['sign-pdf', 'Fill & Sign', 'ph-pen-nib'],
  ['form-filler', 'Fill form', 'ph-textbox'],
  ['add-stamps', 'Stamp', 'ph-stamp'],
  null,
  ['organize-pdf', 'Organize pages', 'ph-files'],
  ['compress-pdf', 'Compress', 'ph-arrows-in'],
  ['ocr-pdf', 'Recognize text (OCR)', 'ph-scan'],
  ['protect-pdf', 'Protect', 'ph-lock-key'],
  ['pdf-to-word', 'Export to Word', 'ph-file-doc'],
];

// File extension -> conversion tool, for non-PDF files opened in the app.
const EXT_ALIASES = {
  jpeg: 'jpg', tif: 'tiff', doc: 'word', docx: 'word', xls: 'excel', xlsx: 'excel',
  ppt: 'powerpoint', pptx: 'powerpoint', eml: 'email', msg: 'email', htm: 'html',
};
function converterFor(name) {
  const ext = name.split('.').pop().toLowerCase();
  const key = EXT_ALIASES[ext] || ext;
  const id = `${key}-to-pdf`;
  if (TOOLS.has(id)) return id;
  if (/^(gif|avif|ico)$/.test(ext)) return 'image-to-pdf';
  return null;
}

// ---------------------------------------------------------------- helpers

const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const icon = (name, cls = 'ph') => h('i', { class: `${cls} ${name}` });

function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
const dirname = (p) => (p ? p.slice(0, p.lastIndexOf('/')) : undefined);
const isPdfBytes = (u8) =>
  u8 && u8.length > 4 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46;
let uid = 0;
const nextId = () => `t${++uid}`;

function toast(message, { actions = [], error = false, timeout = 5000 } = {}) {
  const el = h(
    'div',
    { class: `toast${error ? ' error' : ''}` },
    icon(error ? 'ph-warning-circle' : 'ph-check-circle', 'ph-fill lead'),
    h('span', {}, message),
    h(
      'div',
      { class: 'toast-actions' },
      actions.map((a) =>
        h('button', { class: 'btn sm', onclick: () => { a.fn(); el.remove(); } }, a.label)
      ),
      h('button', { class: 'icon-btn sm', onclick: () => el.remove() }, icon('ph-x'))
    )
  );
  $('#toasts').append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
}

function closeMenus() {
  document.querySelectorAll('.menu-pop').forEach((m) => m.remove());
}
function popMenu(anchor, items) {
  closeMenus();
  const r = anchor.getBoundingClientRect();
  const menu = h(
    'div',
    { class: 'menu-pop' },
    items.map((it) =>
      h('button', { onclick: () => { closeMenus(); it.fn(); } }, icon(it.icon), it.label)
    )
  );
  document.body.append(menu);
  const w = menu.offsetWidth;
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.left = `${Math.min(r.right - w, window.innerWidth - w - 8)}px`;
  setTimeout(() => document.addEventListener('mousedown', function off(e) {
    if (!menu.contains(e.target)) { closeMenus(); document.removeEventListener('mousedown', off); }
  }), 0);
}

function modal(title, body, buttons) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const close = (v) => { backdrop.remove(); resolve(v); };
    backdrop.append(
      h('div', { class: 'modal' }, h('h3', {}, title), body,
        h('div', { class: 'modal-foot' },
          buttons.map((b) => h('button', { class: `btn ${b.primary ? 'primary' : ''}`, onclick: () => close(b.value?.()) }, b.label))))
    );
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(undefined); });
    $('#modal-root').append(backdrop);
    backdrop.querySelector('input')?.focus();
  });
}

// ---------------------------------------------------------------- state

const state = {
  tabs: [],
  active: 'home', // 'home' | 'tools' | tab id
  leftPane: localStorage.getItem('leftPane') !== 'closed',
  panel: localStorage.getItem('panel') || null,
};
const activeTab = () => state.tabs.find((t) => t.id === state.active) || null;

// ---------------------------------------------------------------- tabs

function renderTabs() {
  document.querySelectorAll('#tabstrip .tab.fixed').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === state.active)
  );
  const wrap = $('#doc-tabs');
  wrap.replaceChildren(
    ...state.tabs.map((t) => {
      const isDoc = t.kind === 'doc';
      const el = h(
        'div',
        {
          class: `tab doc${t.id === state.active ? ' active' : ''}`,
          title: isDoc ? t.path || t.name : tool(t.toolId)?.name,
          onmousedown: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t); } },
          onclick: () => activate(t.id),
        },
        isDoc ? icon('ph-file-pdf', 'ph-fill tab-icon-pdf') : icon(tool(t.toolId)?.icon || 'ph-wrench', 'ph tab-icon-tool'),
        h('span', { class: 'tab-name' }, isDoc ? t.name : tool(t.toolId)?.name),
        isDoc && t.dirty ? h('span', { class: 'dirty-dot', title: 'Unsaved changes' }) : null,
        h('span', { class: 'tab-close', title: 'Close (⌘W)', onclick: (e) => { e.stopPropagation(); closeTab(t); } }, icon('ph-x'))
      );
      return el;
    })
  );
  wrap.querySelector('.tab.active')?.scrollIntoView({ inline: 'nearest' });
}

function activate(id) {
  state.active = id;
  const tab = activeTab();
  $('#view-home').hidden = id !== 'home';
  $('#view-tools').hidden = id !== 'tools';
  $('#view-doc').hidden = !tab;
  for (const t of state.tabs) t.stageEl.hidden = t !== tab;
  if (id === 'home') renderRecents();
  if (id === 'tools') $('#tools-search').focus();
  renderTabs();
  syncDocChrome();
  const title = tab ? (tab.kind === 'doc' ? tab.name : tool(tab.toolId)?.name) : id === 'tools' ? 'All tools' : 'Home';
  desktop.setTitle(`${title} — UnAcrobat`);
  desktop.setRepresentedFile(tab?.kind === 'doc' ? tab.path : null, !!tab?.dirty);
}

async function closeTab(tab) {
  if (tab.kind === 'doc' && tab.dirty) {
    const choice = await desktop.confirm({
      message: `Do you want to save changes to “${tab.name}” before closing?`,
      detail: 'Your changes will be lost if you don’t save them.',
      buttons: ['Save', 'Don’t Save', 'Cancel'],
    });
    if (choice === 2) return false;
    if (choice === 0 && !(await saveDoc(tab))) return false;
  }
  const idx = state.tabs.indexOf(tab);
  state.tabs.splice(idx, 1);
  tab.pdfDoc?.destroy();
  tab.stageEl.remove();
  if (state.active === tab.id) {
    const next = state.tabs[idx] || state.tabs[idx - 1];
    activate(next ? next.id : 'home');
  } else {
    renderTabs();
  }
  return true;
}

// ---------------------------------------------------------------- documents

function openDocTab({ name, path, data, dirty = false }) {
  if (path) {
    const existing = state.tabs.find((t) => t.kind === 'doc' && t.path === path);
    if (existing) return activate(existing.id);
  }
  const tab = {
    id: nextId(),
    kind: 'doc',
    name,
    path,
    bytes: data,
    savedBytes: dirty ? null : data,
    dirty,
    history: [],
    future: [],
    tool: null,
    stageEl: h('div', { class: 'tab-stage' }),
  };
  tab.viewerLayer = h('div', { class: 'tab-stage' });
  tab.container = h('div', { class: 'viewer-container', tabindex: '0' }, h('div', { class: 'pdfViewer' }));
  tab.viewerLayer.append(tab.container);
  tab.stageEl.append(tab.viewerLayer);
  $('#stage').append(tab.stageEl);
  state.tabs.push(tab);
  activate(tab.id);
  loadDoc(tab);
  return tab;
}

function askPassword(name, retry) {
  const input = h('input', { type: 'password', class: 'search-input', style: 'padding-left:12px', placeholder: 'Password' });
  const body = h('div', {},
    h('p', { class: 'muted', style: 'margin-top:0' },
      retry ? 'Incorrect password. Try again.' : `“${name}” is password protected. Enter the password to open it.`),
    input);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') body.closest('.modal').querySelector('.btn.primary').click(); });
  return modal('Password required', body, [
    { label: 'Cancel', value: () => null },
    { label: 'Open', primary: true, value: () => input.value },
  ]);
}

async function loadDoc(tab) {
  const keepPage = tab.viewer?.pdfViewer.currentPageNumber;
  const keepScale = tab.viewer?.pdfViewer.currentScaleValue;
  tab.thumbs = null;

  let loading = null;
  if (!tab.viewer) {
    loading = h('div', { class: 'viewer-loading' }, h('div', {}, h('div', { class: 'spinner' }), 'Opening…'));
    tab.viewerLayer.append(loading);
  }

  const task = pdfjsLib.getDocument({ ...DOC_OPTS, data: tab.bytes.slice() });
  task.onPassword = async (update, reason) => {
    const pw = await askPassword(tab.name, reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD);
    if (pw == null) task.destroy();
    else update(pw);
  };
  let pdfDoc;
  try {
    pdfDoc = await task.promise;
  } catch (err) {
    loading?.remove();
    if (err?.name === 'PasswordException' || /destroy/i.test(err?.message || '')) {
      if (!tab.pdfDoc) closeTab(tab);
      return;
    }
    toast(`Couldn’t open “${tab.name}”: ${err.message}`, { error: true, timeout: 8000 });
    if (!tab.pdfDoc) closeTab(tab);
    return;
  }
  loading?.remove();
  const old = tab.pdfDoc;
  tab.pdfDoc = pdfDoc;

  if (!tab.viewer) {
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
    const findController = new PDFFindController({ eventBus, linkService });
    const pdfViewer = new PDFViewer({
      container: tab.container,
      eventBus,
      linkService,
      findController,
      removePageBorders: true,
      annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS,
    });
    linkService.setViewer(pdfViewer);
    tab.viewer = { eventBus, linkService, findController, pdfViewer };

    // Re-fit when panes open/close or the window resizes.
    new ResizeObserver(() => requestAnimationFrame(() => {
      const mode = pdfViewer.currentScaleValue;
      if (pdfViewer.pagesCount && tab.container.offsetParent && ['auto', 'page-fit', 'page-width'].includes(mode)) {
        pdfViewer.currentScaleValue = mode;
      }
    })).observe(tab.container);

    eventBus.on('pagesinit', () => {
      pdfViewer.currentScaleValue = tab.restoreScale || 'auto';
      if (tab.restorePage) pdfViewer.currentPageNumber = Math.min(tab.restorePage, pdfViewer.pagesCount);
      tab.restoreScale = tab.restorePage = null;
      if (tab === activeTab()) syncDocChrome();
    });
    eventBus.on('pagechanging', () => {
      if (tab !== activeTab()) return;
      syncPageUI();
      highlightThumb(tab);
    });
    eventBus.on('scalechanging', () => tab === activeTab() && syncZoomUI());
    eventBus.on('updatefindmatchescount', ({ matchesCount }) => tab === activeTab() && syncFindCount(matchesCount));
    eventBus.on('updatefindcontrolstate', ({ state: s, matchesCount }) => {
      if (tab !== activeTab()) return;
      if (s === 1) $('#find-count').textContent = 'No results';
      else syncFindCount(matchesCount);
    });
  }
  tab.restorePage = keepPage;
  tab.restoreScale = keepScale;
  tab.viewer.pdfViewer.setDocument(pdfDoc);
  tab.viewer.linkService.setDocument(pdfDoc);
  old?.destroy();
  if (tab === activeTab()) {
    syncDocChrome();
    if (state.panel) renderPanel();
  }
}

function applyEdit(tab, bytes) {
  tab.history.push(tab.bytes);
  if (tab.history.length > 30) tab.history.shift();
  tab.future = [];
  setBytes(tab, bytes);
}
function setBytes(tab, bytes) {
  tab.bytes = bytes;
  tab.dirty = tab.bytes !== tab.savedBytes;
  loadDoc(tab);
  renderTabs();
  if (tab === activeTab()) desktop.setRepresentedFile(tab.path, tab.dirty);
}

async function saveDoc(tab, { as = false } = {}) {
  if (!tab || tab.kind !== 'doc') return false;
  let target = tab.path;
  try {
    if (as || !target) {
      target = await desktop.saveAs(tab.name.replace(/\.pdf$/i, '') + '.pdf', tab.bytes, dirname(tab.path));
      if (!target) return false;
    } else {
      await desktop.save(target, tab.bytes);
    }
  } catch (err) {
    toast(`Save failed: ${err.message}`, { error: true, timeout: 8000 });
    return false;
  }
  tab.path = target;
  tab.name = target.split('/').pop();
  tab.savedBytes = tab.bytes;
  tab.dirty = false;
  renderTabs();
  if (tab === activeTab()) activate(tab.id);
  toast(`Saved “${tab.name}”`);
  return true;
}

// ---------------------------------------------------------------- tool frames

const FRAME_CSS = `
  nav[data-simple-nav], footer[data-simple-footer], #back-to-tools { display: none !important; }
  :root {
    --color-indigo-300: #8ec1ff; --color-indigo-400: #5aa4fb; --color-indigo-500: #3b8ff5;
    --color-indigo-600: #1a73e8; --color-indigo-700: #1565d0;
  }
  html, body { background: #222 !important; }
  #uploader { min-height: 100% !important; }
`;

function mountToolFrame(wrap, toolId, file, onLeave) {
  const loading = h('div', { class: 'frame-loading' }, h('div', {}, h('div', { class: 'spinner' }), `Loading ${tool(toolId)?.name || 'tool'}…`));
  const iframe = h('iframe', { src: `/${toolId}.html`, allow: 'clipboard-read; clipboard-write' });
  wrap.replaceChildren(iframe, loading);
  let injected = false;

  iframe.addEventListener('load', () => {
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!doc) return;
    const p = win.location.pathname.replace(/\.html$/, '').replace(/\/$/, '');
    // The page navigated back to the tool index: treat as "close tool".
    if (p === '' || p === '/index') return onLeave();

    doc.head.append(Object.assign(doc.createElement('style'), { textContent: FRAME_CSS }));
    // In-page links to other tools open as shell tabs rather than navigating the frame.
    doc.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a || a.target === '_blank') return;
      const url = new URL(a.href, win.location.href);
      if (url.origin !== location.origin) return;
      const id = url.pathname.replace(/^\//, '').replace(/\.html$/, '');
      if (id === '' || id === 'index') { e.preventDefault(); onLeave(); }
      else if (TOOLS.has(id) && id !== toolId) { e.preventDefault(); openToolTab(id); }
    }, true);

    loading.style.opacity = '0';
    setTimeout(() => loading.remove(), 250);
    if (file && !injected) {
      injected = true;
      injectFile(iframe, file);
    }
  });
  return iframe;
}

// Hands the document to the tool page's own upload input, as if the user had
// picked it in the file dialog.
async function injectFile(iframe, file) {
  const deadline = Date.now() + 8000;
  const win = iframe.contentWindow;
  let input = null;
  while (Date.now() < deadline) {
    const doc = iframe.contentDocument;
    const candidates = [...(doc?.querySelectorAll('input[type=file]') || [])];
    input =
      candidates.find((i) => i.id === 'file-input') ||
      candidates.find((i) => /pdf/i.test(i.accept || '')) ||
      candidates.find((i) => !i.accept);
    if (input) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!input) return;
  const accept = (input.accept || '').toLowerCase();
  const isPdf = /\.pdf$/i.test(file.name);
  if (isPdf && accept && !/pdf|\*/.test(accept)) return;
  await new Promise((r) => setTimeout(r, 250)); // let page scripts finish wiring listeners
  try {
    const dt = new win.DataTransfer();
    dt.items.add(new win.File([file.data], file.name, { type: isPdf ? 'application/pdf' : '' }));
    input.files = dt.files;
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
  } catch (err) {
    console.warn('File injection failed', err);
  }
}

function toolHeader(toolId, subtitle, onClose) {
  const t = tool(toolId);
  return h('div', { class: 'tool-header' },
    h('div', { class: 't-icon', style: `background:${t.color}` }, icon(t.icon)),
    h('div', { style: 'min-width:0' }, h('div', { class: 't-title' }, t.name), h('div', { class: 't-sub' }, subtitle)),
    h('div', { class: 'spacer' }),
    onClose ? h('button', { class: 'btn sm', onclick: onClose }, icon('ph-x'), 'Close tool') : null
  );
}

function runToolOnDoc(tab, toolId) {
  if (!takesPdf(toolId)) return openToolTab(toolId);
  if (tab.tool) closeTool(tab);
  const wrap = h('div', { class: 'tool-frame-wrap' });
  const layer = h('div', { class: 'tab-stage' },
    toolHeader(toolId, `Working on “${tab.name}” · Results come back into this document`, () => closeTool(tab)),
    wrap);
  tab.tool = { id: toolId, layer };
  tab.viewerLayer.hidden = true;
  tab.stageEl.append(layer);
  mountToolFrame(wrap, toolId, { name: tab.name.endsWith('.pdf') ? tab.name : `${tab.name}.pdf`, data: tab.bytes }, () => closeTool(tab));
  syncDocChrome();
}

function closeTool(tab) {
  if (!tab.tool) return;
  tab.tool.layer.remove();
  tab.tool = null;
  tab.viewerLayer.hidden = false;
  if (tab === activeTab()) syncDocChrome();
}

function openToolTab(toolId, file) {
  if (!TOOLS.has(toolId)) return;
  if (!file) {
    const existing = state.tabs.find((t) => t.kind === 'tool' && t.toolId === toolId);
    if (existing) return activate(existing.id);
  }
  const t = tool(toolId);
  const wrap = h('div', { class: 'tool-frame-wrap' });
  const tab = {
    id: nextId(),
    kind: 'tool',
    toolId,
    stageEl: h('div', { class: 'tab-stage' }, toolHeader(toolId, t.subtitle), wrap),
  };
  $('#stage').append(tab.stageEl);
  state.tabs.push(tab);
  activate(tab.id);
  mountToolFrame(wrap, toolId, file, () => closeTab(tab));
}

function runTool(toolId) {
  const tab = activeTab();
  if (tab?.kind === 'doc') runToolOnDoc(tab, toolId);
  else openToolTab(toolId);
}

// Result files from tools come back from the main process.
desktop.onToolOutput((file) => {
  const tab = activeTab();
  if (tab?.kind === 'doc' && tab.tool && !NEW_DOC_TOOLS.has(tab.tool.id)) {
    const name = tool(tab.tool.id).name;
    closeTool(tab); // viewer must be visible before it reloads
    applyEdit(tab, file.data);
    toast(`${name} applied to “${tab.name}”`, {
      actions: [{ label: 'Undo', fn: () => undo(tab) }, { label: 'Save', fn: () => saveDoc(tab) }],
      timeout: 8000,
    });
  } else {
    const doc = openDocTab({ name: file.name, path: null, data: file.data, dirty: true });
    toast(`Opened result “${file.name}” — not saved yet`, {
      actions: [{ label: 'Save As…', fn: () => saveDoc(doc, { as: true }) }],
      timeout: 8000,
    });
  }
});

// ---------------------------------------------------------------- doc chrome

function syncDocChrome() {
  const tab = activeTab();
  const bar = $('#doc-toolbar');
  const inTool = !tab || tab.kind !== 'doc' || !!tab.tool;
  bar.classList.toggle('tool-mode', inTool);
  $('#tools-pane').classList.toggle('collapsed', !state.leftPane || tab?.kind === 'tool');
  $('#quick-rail').hidden = tab?.kind === 'tool';
  const docOnly = tab?.kind === 'doc';
  for (const cmd of ['save', 'print', 'undo', 'redo', 'share-export']) {
    const b = bar.querySelector(`[data-cmd="${cmd}"]`);
    b.disabled = !docOnly || (cmd === 'undo' && !tab.history.length) || (cmd === 'redo' && !tab.future.length);
  }
  const showPanel = docOnly && !!state.panel;
  $('#side-panel').hidden = !showPanel;
  $('#right-rail').hidden = !docOnly;
  document.querySelectorAll('#right-rail .rail-btn').forEach((b) => b.classList.toggle('on', b.dataset.panel === state.panel));
  document.querySelectorAll('#quick-rail .rail-btn').forEach((b) => b.classList.toggle('on', b.dataset.tool === tab?.tool?.id));
  document.querySelectorAll('#pane-list .pane-tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === tab?.tool?.id));
  if (showPanel) renderPanel();
  if (docOnly && tab.viewer) {
    syncPageUI();
    syncZoomUI();
  }
}

function syncPageUI() {
  const v = activeTab()?.viewer?.pdfViewer;
  if (!v) return;
  if (document.activeElement !== $('#page-input')) $('#page-input').value = v.currentPageNumber;
  $('#page-count').textContent = `/ ${v.pagesCount}`;
}
function syncZoomUI() {
  const v = activeTab()?.viewer?.pdfViewer;
  if (!v) return;
  const sel = $('#zoom-select');
  const val = v.currentScaleValue;
  const opt = [...sel.options].find((o) => o.value === String(val));
  if (opt && opt.value !== 'custom') sel.value = opt.value;
  else {
    const custom = sel.querySelector('[value=custom]');
    custom.textContent = `${Math.round(v.currentScale * 100)}%`;
    sel.value = 'custom';
  }
}
function syncFindCount(mc) {
  $('#find-count').textContent = mc && mc.total ? `${mc.current} of ${mc.total}` : '';
}

function find(again, previous = false) {
  const tab = activeTab();
  if (!tab?.viewer) return;
  const query = $('#find-input').value;
  if (!query) { $('#find-count').textContent = ''; }
  tab.viewer.eventBus.dispatch('find', {
    source: null,
    type: again ? 'again' : '',
    query,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: previous,
    matchDiacritics: false,
  });
}

// ---------------------------------------------------------------- side panel

const PANEL_TITLES = {
  thumbnails: 'Page thumbnails',
  bookmarks: 'Bookmarks',
  attachments: 'Attachments',
  properties: 'Document properties',
};

function togglePanel(name) {
  state.panel = state.panel === name ? null : name;
  localStorage.setItem('panel', state.panel || '');
  syncDocChrome();
}

let panelRenderToken = 0;
async function renderPanel() {
  const tab = activeTab();
  const body = $('#side-body');
  if (!tab?.pdfDoc || !state.panel) return body.replaceChildren();
  $('#side-title').textContent = PANEL_TITLES[state.panel];
  const token = ++panelRenderToken;
  const stale = () => token !== panelRenderToken;

  if (state.panel === 'thumbnails') {
    if (!tab.thumbs || tab.thumbsDoc !== tab.pdfDoc) buildThumbs(tab);
    body.replaceChildren(tab.thumbs);
    highlightThumb(tab, true);
  } else if (state.panel === 'bookmarks') {
    const outline = await tab.pdfDoc.getOutline();
    if (stale()) return;
    if (!outline?.length) return body.replaceChildren(h('div', { class: 'empty' }, icon('ph-bookmark-simple'), 'This document has no bookmarks'));
    const build = (items) => h('ul', { class: 'outline-list' }, items.map((it) => {
      const li = h('li', { class: it.items?.length ? 'closed' : '' });
      li.append(h('div', { class: 'outline-item' },
        h('button', { class: 'toggle', onclick: () => li.classList.toggle('closed') }, it.items?.length ? icon('ph-caret-right') : ''),
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); if (it.dest) tab.viewer.linkService.goToDestination(it.dest); else if (it.url) window.open(it.url); } }, it.title)));
      if (it.items?.length) li.append(build(it.items));
      return li;
    }));
    body.replaceChildren(build(outline));
  } else if (state.panel === 'attachments') {
    const att = await tab.pdfDoc.getAttachments();
    if (stale()) return;
    const list = Object.values(att || {});
    if (!list.length) return body.replaceChildren(h('div', { class: 'empty' }, icon('ph-paperclip'), 'No attachments'));
    body.replaceChildren(...list.map((a) => h('button', {
      class: 'attach-item',
      onclick: () => {
        if (/\.pdf$/i.test(a.filename)) return openDocTab({ name: a.filename, path: null, data: a.content, dirty: true });
        const url = URL.createObjectURL(new Blob([a.content]));
        h('a', { href: url, download: a.filename }).click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      },
    }, icon('ph-file'), h('span', {}, a.filename), h('span', { class: 'muted', style: 'margin-left:auto' }, formatBytes(a.content.length)))));
  } else if (state.panel === 'properties') {
    const [{ info }, page1] = await Promise.all([tab.pdfDoc.getMetadata(), tab.pdfDoc.getPage(1)]);
    if (stale()) return;
    const vp = page1.getViewport({ scale: 1 });
    const inches = (pt) => (pt / 72).toFixed(2);
    const fmtDate = (d) => {
      const dt = d && pdfjsLib.PDFDateString.toDateObject(d);
      return dt ? dt.toLocaleString() : '—';
    };
    const rows = [
      ['File', tab.name],
      ['Location', tab.path ? dirname(tab.path) : 'Not saved'],
      ['Size', formatBytes(tab.bytes.length)],
      ['Pages', tab.pdfDoc.numPages],
      ['Page size', `${inches(vp.width)} × ${inches(vp.height)} in`],
      ['PDF version', info.PDFFormatVersion || '—'],
      ['Title', info.Title || '—'],
      ['Author', info.Author || '—'],
      ['Subject', info.Subject || '—'],
      ['Keywords', info.Keywords || '—'],
      ['Creator', info.Creator || '—'],
      ['Producer', info.Producer || '—'],
      ['Created', fmtDate(info.CreationDate)],
      ['Modified', fmtDate(info.ModDate)],
      ['Tagged', info.IsTagged ? 'Yes' : 'No'],
      ['Form fields', info.IsAcroFormPresent ? 'Yes' : 'No'],
    ];
    body.replaceChildren(
      h('table', { class: 'prop-table' }, rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, String(v))))),
      h('div', { style: 'margin-top:14px;display:flex;gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn sm', onclick: () => runToolOnDoc(tab, 'edit-metadata') }, icon('ph-pencil-simple'), 'Edit metadata'),
        tab.path ? h('button', { class: 'btn sm', onclick: () => desktop.reveal(tab.path) }, icon('ph-folder'), 'Show in Finder') : null)
    );
  }
}

function buildThumbs(tab) {
  const pdf = tab.pdfDoc;
  tab.thumbsDoc = pdf;
  const wrap = h('div', { class: 'thumbs' });
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || e.target.dataset.rendered) continue;
      e.target.dataset.rendered = '1';
      renderThumb(pdf, Number(e.target.dataset.page), e.target.querySelector('.thumb-page'));
    }
  }, { root: $('#side-body'), rootMargin: '400px' });
  for (let i = 1; i <= pdf.numPages; i++) {
    const el = h('div', { class: 'thumb', dataset: { page: i }, onclick: () => { tab.viewer.pdfViewer.currentPageNumber = i; } },
      h('div', { class: 'thumb-page', style: 'height:168px' }),
      h('span', {}, i));
    wrap.append(el);
    observer.observe(el);
  }
  tab.thumbs = wrap;
}

async function renderThumb(pdf, n, box) {
  try {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = (130 / base.width) * (window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale });
    const canvas = h('canvas', { width: Math.floor(vp.width), height: Math.floor(vp.height) });
    box.style.height = `${(130 * base.height) / base.width}px`;
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    box.replaceChildren(canvas);
  } catch {
    /* doc was replaced while rendering */
  }
}

function highlightThumb(tab, scroll = false) {
  if (!tab.thumbs || state.panel !== 'thumbnails') return;
  const n = tab.viewer?.pdfViewer.currentPageNumber;
  tab.thumbs.querySelectorAll('.thumb.current').forEach((t) => t.classList.remove('current'));
  const cur = tab.thumbs.querySelector(`.thumb[data-page="${n}"]`);
  if (cur) {
    cur.classList.add('current');
    cur.scrollIntoView({ block: 'nearest', behavior: scroll ? 'auto' : 'smooth' });
  }
}

// ---------------------------------------------------------------- print

async function printDoc(tab) {
  if (!tab?.pdfDoc) return;
  const pdf = tab.pdfDoc;
  const root = $('#print-root');
  toast(`Preparing ${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''} for printing…`, { timeout: 2500 });
  const urls = [];
  const imgs = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 150 / 72 });
    const canvas = h('canvas', { width: Math.floor(vp.width), height: Math.floor(vp.height) });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport: vp, intent: 'print', annotationMode: pdfjsLib.AnnotationMode.ENABLE_STORAGE }).promise;
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const img = h('img', { src: url });
    imgs.push(img);
  }
  root.replaceChildren(...imgs);
  await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
  window.print();
  root.replaceChildren();
  urls.forEach((u) => URL.revokeObjectURL(u));
}

// ---------------------------------------------------------------- undo / redo

function editableFocus() {
  let el = document.activeElement;
  let doc = document;
  while (el?.tagName === 'IFRAME') {
    try {
      doc = el.contentDocument;
      el = doc?.activeElement;
    } catch {
      break;
    }
  }
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return doc;
  // Tools with their own canvas editors own the keyboard while they're open.
  if (activeTab()?.kind === 'tool' || activeTab()?.tool) return doc;
  return null;
}

function undo(tab = activeTab()) {
  if (tab === activeTab()) {
    const doc = editableFocus();
    if (doc) return doc.execCommand('undo');
  }
  if (tab?.kind !== 'doc' || !tab.history.length) return;
  tab.future.push(tab.bytes);
  setBytes(tab, tab.history.pop());
  syncDocChrome();
}
function redo(tab = activeTab()) {
  const doc = editableFocus();
  if (doc) return doc.execCommand('redo');
  if (tab?.kind !== 'doc' || !tab.future.length) return;
  tab.history.push(tab.bytes);
  setBytes(tab, tab.future.pop());
  syncDocChrome();
}

// ---------------------------------------------------------------- commands

function zoom(value) {
  const v = activeTab()?.viewer?.pdfViewer;
  if (!v) return;
  if (value === 'in') v.increaseScale();
  else if (value === 'out') v.decreaseScale();
  else v.currentScaleValue = String(value);
}

function exportMenu(anchor) {
  const tab = activeTab();
  if (tab?.kind !== 'doc') return;
  popMenu(anchor, [
    { label: 'Save a copy…', icon: 'ph-copy', fn: () => desktop.saveAs(tab.name, tab.bytes, dirname(tab.path)) },
    { label: 'Export to Word (.docx)', icon: 'ph-file-doc', fn: () => runToolOnDoc(tab, 'pdf-to-word') },
    { label: 'Export to Excel (.xlsx)', icon: 'ph-file-xls', fn: () => runToolOnDoc(tab, 'pdf-to-excel') },
    { label: 'Export to images (PNG)', icon: 'ph-file-png', fn: () => runToolOnDoc(tab, 'pdf-to-png') },
    { label: 'Export to images (JPG)', icon: 'ph-file-jpg', fn: () => runToolOnDoc(tab, 'pdf-to-jpg') },
    { label: 'Export to text', icon: 'ph-file-text', fn: () => runToolOnDoc(tab, 'pdf-to-text') },
    { label: 'Export to Markdown', icon: 'ph-markdown-logo', fn: () => runToolOnDoc(tab, 'pdf-to-markdown') },
    { label: 'Save as PDF/A', icon: 'ph-archive', fn: () => runToolOnDoc(tab, 'pdf-to-pdfa') },
  ]);
}

const COMMANDS = {
  'toggle-left': () => {
    state.leftPane = !state.leftPane;
    localStorage.setItem('leftPane', state.leftPane ? 'open' : 'closed');
    syncDocChrome();
  },
  save: () => saveDoc(activeTab()),
  'save-as': () => saveDoc(activeTab(), { as: true }),
  revert: () => {
    const tab = activeTab();
    if (tab?.kind === 'doc' && tab.savedBytes && tab.dirty) applyEdit(tab, tab.savedBytes);
  },
  print: () => {
    const tab = activeTab();
    if (tab?.kind === 'doc') printDoc(tab);
  },
  undo: () => undo(),
  redo: () => redo(),
  'prev-page': () => activeTab()?.viewer?.pdfViewer.previousPage(),
  'next-page': () => activeTab()?.viewer?.pdfViewer.nextPage(),
  'zoom-in': () => zoom('in'),
  'zoom-out': () => zoom('out'),
  zoom: (v) => zoom(v),
  'rotate-cw': () => rotate(90),
  'rotate-ccw': () => rotate(-90),
  rotate: (d) => rotate(d),
  spread: (mode) => {
    const v = activeTab()?.viewer?.pdfViewer;
    if (!v) return;
    const modes = { single: 0, odd: 1, even: 2 };
    v.spreadMode = mode in modes ? modes[mode] : (v.spreadMode + 1) % 3;
  },
  find: () => {
    const tab = activeTab();
    if (tab?.kind === 'doc' && !tab.tool) { $('#find-input').focus(); $('#find-input').select(); }
  },
  'find-next': () => find(true, false),
  'find-prev': () => find(true, true),
  'share-export': (_, el) => exportMenu(el),
  'close-panel': () => togglePanel(state.panel),
  panel: (name) => togglePanel(name),
  'close-tab': () => {
    const tab = activeTab();
    if (tab) closeTab(tab);
    else desktop.closeConfirmed();
  },
  reveal: () => {
    const tab = activeTab();
    if (tab?.path) desktop.reveal(tab.path);
  },
  properties: () => {
    if (activeTab()?.kind === 'doc') { state.panel = 'properties'; syncDocChrome(); }
  },
  home: () => activate('home'),
  'all-tools': () => activate('tools'),
  'open-tool': (id) => openToolTab(id),
  'run-tool': (id) => runTool(id),
  'open-url': (url) => {
    const id = new URL(url).pathname.replace(/^\//, '').replace(/\.html$/, '');
    if (TOOLS.has(id)) openToolTab(id);
  },
  'recents-changed': () => state.active === 'home' && renderRecents(),
};

function rotate(delta) {
  const v = activeTab()?.viewer?.pdfViewer;
  if (v) v.pagesRotation = (v.pagesRotation + delta + 360) % 360;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cmd]');
  if (btn && !btn.disabled) COMMANDS[btn.dataset.cmd]?.(undefined, btn);
});
desktop.onMenu((cmd, arg) => COMMANDS[cmd]?.(arg));

// ---------------------------------------------------------------- home view

function recCard([id, label, ic]) {
  const t = tool(id);
  if (!t) return null;
  return h('button', { class: 'rec-card', onclick: () => openToolTab(id) },
    h('div', { class: 'rec-icon', style: `background:${t.color}` }, icon(ic)),
    h('strong', {}, label),
    h('span', {}, t.subtitle));
}

async function renderRecents() {
  const list = await desktop.listRecents();
  const q = $('#recent-filter').value.trim().toLowerCase();
  const rows = list.filter((r) => !q || r.name.toLowerCase().includes(q));
  const table = $('#recent-table');
  if (!rows.length) {
    table.replaceChildren(h('div', { class: 'empty' }, icon('ph-clock-counter-clockwise'),
      q ? 'No recent files match your filter' : 'Files you open will appear here'));
    return;
  }
  table.replaceChildren(
    h('div', { class: 'recent-row head' }, h('span'), h('span', {}, 'Name'), h('span', {}, 'Location'), h('span', {}, 'Size'), h('span', {}, 'Opened'), h('span')),
    ...rows.map((r) => h('div', {
      class: `recent-row${r.exists ? '' : ' missing'}`,
      title: r.exists ? r.path : 'File not found',
      ondblclick: () => r.exists && desktop.openPaths([r.path]),
      onclick: (e) => { if (!e.target.closest('.row-actions') && r.exists) desktop.openPaths([r.path]); },
    },
    icon('ph-file-pdf', 'ph-fill file-ico'),
    h('span', { class: 'name' }, r.name),
    h('span', { class: 'loc' }, h('bdi', {}, dirname(r.path).replace(/^\/Users\/[^/]+/, '~'))),
    h('span', { class: 'meta' }, formatBytes(r.size)),
    h('span', { class: 'meta' }, timeAgo(r.openedAt)),
    h('span', { class: 'row-actions' },
      r.exists ? h('button', { class: 'icon-btn sm', title: 'Show in Finder', onclick: () => desktop.reveal(r.path) }, icon('ph-folder')) : null,
      h('button', { class: 'icon-btn sm', title: 'Remove from recent', onclick: async () => { await desktop.removeRecent(r.path); renderRecents(); } }, icon('ph-x')))
    ))
  );
}

function renderHome() {
  const hour = new Date().getHours();
  $('#greeting').textContent = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('#recommended').replaceChildren(...RECOMMENDED.map(recCard).filter(Boolean));
  $('#home-open').onclick = () => desktop.openDialog();
  $('#home-open-2').onclick = () => desktop.openDialog();
  $('#recent-filter').oninput = renderRecents;
  $('#recent-clear').onclick = async () => { await desktop.clearRecents(); renderRecents(); };
}

// ---------------------------------------------------------------- all tools view

function toolCard(t) {
  return h('button', { class: 'tool-card', title: t.subtitle, onclick: () => openToolTab(t.id) },
    h('div', { class: 't-icon', style: `background:${tool(t.id)?.color || '#555'}` }, icon(t.icon)),
    h('div', {}, h('strong', {}, t.name), h('span', {}, t.subtitle)));
}

function renderToolsView() {
  const q = $('#tools-search').value.trim().toLowerCase();
  const main = $('#tools-main');
  const match = (t) => !q || `${t.name} ${t.subtitle}`.toLowerCase().includes(q);
  const sections = [];
  const seen = new Set();
  for (const cat of CATEGORIES) {
    const tools = cat.tools.filter((t) => match(t) && !(q && seen.has(t.id)));
    tools.forEach((t) => seen.add(t.id));
    if (!tools.length) continue;
    sections.push(h('h2', { id: `cat-${slug(cat.name)}` }, cat.name), h('div', { class: 'tool-grid' }, tools.map(toolCard)));
  }
  main.replaceChildren(...(sections.length ? sections : [h('div', { class: 'empty' }, icon('ph-magnifying-glass'), `No tools match “${q}”`)]));
  $('#tools-cats').replaceChildren(...CATEGORIES.map((cat) => h('button', {
    class: 'cat-link',
    onclick: () => document.getElementById(`cat-${slug(cat.name)}`)?.scrollIntoView({ behavior: 'smooth' }),
  }, cat.name, h('small', {}, cat.tools.filter(match).length))));
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// ---------------------------------------------------------------- doc view panes

function renderQuickRail() {
  $('#quick-rail').replaceChildren(
    ...QUICK_RAIL.map((item) => {
      if (!item) return h('div', { class: 'rail-sep' });
      const [id, label, ic] = item;
      return h('button', { class: 'rail-btn', 'data-tip': label, dataset: { tool: id }, onclick: () => runTool(id) }, icon(ic));
    }),
    h('div', { class: 'rail-sep' }),
    h('button', { class: 'rail-btn', 'data-tip': 'All tools', onclick: COMMANDS['toggle-left'] }, icon('ph-dots-three-outline'))
  );
}

const openCats = new Set(JSON.parse(localStorage.getItem('openCats') || '["Edit & Annotate","Organize & Manage"]'));
function renderPaneList() {
  const q = $('#pane-search').value.trim().toLowerCase();
  const list = $('#pane-list');
  list.replaceChildren(
    ...CATEGORIES.filter((c) => c.name !== POPULAR).map((cat) => {
      const tools = cat.tools.filter((t) => !q || `${t.name} ${t.subtitle}`.toLowerCase().includes(q));
      if (!tools.length) return null;
      const style = CAT_STYLE[cat.name];
      const el = h('div', { class: `pane-cat${q || openCats.has(cat.name) ? ' open' : ''}` },
        h('button', {
          onclick: () => {
            el.classList.toggle('open');
            if (el.classList.contains('open')) openCats.add(cat.name); else openCats.delete(cat.name);
            localStorage.setItem('openCats', JSON.stringify([...openCats]));
          },
        }, h('span', { class: 'cat-icon', style: `background:${style.color}` }, icon(style.icon)), cat.name, icon('ph-caret-right', 'ph caret')),
        h('ul', {}, tools.map((t) => h('li', {}, h('button', { class: 'pane-tool', title: t.subtitle, dataset: { tool: t.id }, onclick: () => runTool(t.id) }, icon(t.icon), t.name)))));
      return el;
    }).filter(Boolean)
  );
  syncDocChrome();
}

// ---------------------------------------------------------------- opening files

async function handleOpenedFiles(files) {
  for (const f of files) {
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    if (/\.pdf$/i.test(f.name) || isPdfBytes(data)) {
      openDocTab({ name: f.name, path: f.path, data });
      continue;
    }
    const conv = converterFor(f.name);
    if (conv) {
      openToolTab(conv, { name: f.name, data });
      toast(`Opened “${f.name}” in ${tool(conv).name}`);
    } else {
      toast(`UnAcrobat can’t open “${f.name}”`, { error: true });
    }
  }
}
desktop.onFilesOpen(handleOpenedFiles);
desktop.onToast(({ message, revealPath }) =>
  toast(message, { actions: revealPath ? [{ label: 'Show in Finder', fn: () => desktop.reveal(revealPath) }] : [] })
);

// Drag & drop onto the shell (drops over a tool's own iframe go to the tool).
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  $('#drop-overlay').hidden = false;
});
document.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; }
});
document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').hidden = true;
  const paths = [...(e.dataTransfer?.files || [])].map((f) => desktop.pathForFile(f)).filter(Boolean);
  if (paths.length) desktop.openPaths(paths);
});

// ---------------------------------------------------------------- quit

desktop.onBeforeClose(async () => {
  for (const tab of state.tabs.filter((t) => t.kind === 'doc' && t.dirty)) {
    activate(tab.id);
    const choice = await desktop.confirm({
      message: `Do you want to save changes to “${tab.name}” before closing?`,
      detail: 'Your changes will be lost if you don’t save them.',
      buttons: ['Save', 'Don’t Save', 'Cancel'],
    });
    if (choice === 2 || (choice === 0 && !(await saveDoc(tab)))) return desktop.closeCancelled();
  }
  desktop.closeConfirmed();
});

// ---------------------------------------------------------------- wiring

document.querySelectorAll('#tabstrip .tab.fixed').forEach((b) => b.addEventListener('click', () => activate(b.dataset.tab)));
$('#title-open').addEventListener('click', () => desktop.openDialog());
$('#titlebar').addEventListener('dblclick', (e) => { if (e.target.closest('.titlebar-fill, .traffic-space')) desktop.toggleMaximize(); });
$('#tools-search').addEventListener('input', renderToolsView);
$('#pane-search').addEventListener('input', renderPaneList);
document.querySelectorAll('#right-rail .rail-btn').forEach((b) => b.addEventListener('click', () => togglePanel(b.dataset.panel)));

$('#page-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const v = activeTab()?.viewer?.pdfViewer;
  const n = parseInt(e.target.value, 10);
  if (v && n >= 1 && n <= v.pagesCount) v.currentPageNumber = n;
  e.target.blur();
});
$('#page-input').addEventListener('blur', syncPageUI);
$('#zoom-select').addEventListener('change', (e) => {
  if (e.target.value !== 'custom') zoom(e.target.value);
});
let findTimer;
$('#find-input').addEventListener('input', () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(() => find(false), 200);
});
$('#find-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') find(true, e.shiftKey);
  if (e.key === 'Escape') { e.target.value = ''; find(false); e.target.blur(); }
});

// Keyboard page navigation when the viewer (not a text field) has focus.
document.addEventListener('keydown', (e) => {
  const tab = activeTab();
  if (!tab?.viewer || tab.tool || e.metaKey || e.ctrlKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  const v = tab.viewer.pdfViewer;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { v.nextPage(); e.preventDefault(); }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { v.previousPage(); e.preventDefault(); }
  if (e.key === 'Home') { v.currentPageNumber = 1; e.preventDefault(); }
  if (e.key === 'End') { v.currentPageNumber = v.pagesCount; e.preventDefault(); }
});
// Pinch / ⌘-scroll zoom in the viewer.
$('#stage').addEventListener('wheel', (e) => {
  const v = activeTab()?.viewer?.pdfViewer;
  if (!v || !(e.ctrlKey || e.metaKey) || activeTab()?.tool) return;
  e.preventDefault();
  v.updateScale({ steps: e.deltaY < 0 ? 1 : -1, origin: [e.clientX, e.clientY] });
}, { passive: false });

renderHome();
renderToolsView();
renderQuickRail();
renderPaneList();
activate('home');
desktop.ready();
