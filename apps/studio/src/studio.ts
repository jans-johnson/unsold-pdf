import type { HostBridge, OpenedDocument } from '@unacrobat/bridge';
import { $, h, icon, isPdfBytes, nextId, storage, store } from './dom.ts';
import {
  converterFor,
  hasTool,
  NEW_DOCUMENT_TOOLS,
  takesPdf,
  tool,
} from './catalog.ts';
import { mountToolFrame, type FrameFile } from './frames.ts';
import {
  highlightThumb,
  printDocument,
  renderPanel,
  type PanelName,
} from './panels.ts';
import { DOCUMENT_OPTIONS, pdfjs } from './pdf.ts';
import { HISTORY_LIMIT, type DocTab, type Tab, type ToolTab } from './tabs.ts';
import { askPassword, confirmUnsaved, popMenu, toast } from './ui/feedback.ts';
import { createViewer, find } from './viewer.ts';

type View = 'home' | 'tools';

/** Owns the open tabs and everything that happens to a document. */
export class Studio {
  tabs: Tab[] = [];
  active: View | string = 'home';
  leftPane = storage('leftPane') !== 'closed';
  panel = (storage('panel') || null) as PanelName | null;
  /** Called when the home view needs refreshing (recents changed). */
  onHomeShown: () => void = () => {};

  constructor(readonly host: HostBridge) {}

  activeTab(): Tab | null {
    return this.tabs.find((t) => t.id === this.active) ?? null;
  }

  activeDoc(): DocTab | null {
    const tab = this.activeTab();
    return tab?.kind === 'doc' ? tab : null;
  }

  // ------------------------------------------------------------------ tabs

  renderTabs() {
    document
      .querySelectorAll<HTMLElement>('#tabstrip .tab.fixed')
      .forEach((b) =>
        b.classList.toggle('active', b.dataset.tab === this.active)
      );
    const wrap = $('#doc-tabs');
    wrap.replaceChildren(
      ...this.tabs.map((t) => {
        const isDoc = t.kind === 'doc';
        const label = isDoc ? t.name : (tool(t.toolId)?.name ?? t.toolId);
        return h(
          'div',
          {
            class: `tab doc${t.id === this.active ? ' active' : ''}`,
            title: isDoc ? (t.handle ?? t.name) : label,
            onmousedown: (e: MouseEvent) => {
              if (e.button === 1) {
                e.preventDefault();
                void this.closeTab(t);
              }
            },
            onclick: () => this.activate(t.id),
          },
          isDoc
            ? icon('ph-file-pdf', 'ph-fill tab-icon-pdf')
            : icon(tool(t.toolId)?.icon ?? 'ph-wrench', 'ph tab-icon-tool'),
          h('span', { class: 'tab-name' }, label),
          isDoc && t.dirty
            ? h('span', { class: 'dirty-dot', title: 'Unsaved changes' })
            : null,
          h(
            'span',
            {
              class: 'tab-close',
              title: 'Close',
              onclick: (e: Event) => {
                e.stopPropagation();
                void this.closeTab(t);
              },
            },
            icon('ph-x')
          )
        );
      })
    );
    wrap.querySelector('.tab.active')?.scrollIntoView({ inline: 'nearest' });
  }

  activate(id: View | string) {
    this.active = id;
    const tab = this.activeTab();
    $('#view-home').hidden = id !== 'home';
    $('#view-tools').hidden = id !== 'tools';
    $('#view-doc').hidden = !tab;
    for (const t of this.tabs) t.stageEl.hidden = t !== tab;
    if (id === 'home') this.onHomeShown();
    if (id === 'tools') $('#tools-search').focus();
    this.renderTabs();
    this.syncChrome();
    const title = tab
      ? tab.kind === 'doc'
        ? tab.name
        : tool(tab.toolId)?.name
      : id === 'tools'
        ? 'All tools'
        : 'Home';
    void this.host.setTitle(`${title} — UnAcrobat`);
  }

  async closeTab(tab: Tab): Promise<boolean> {
    if (tab.kind === 'doc' && tab.dirty) {
      this.activate(tab.id);
      const choice = await confirmUnsaved(tab.name);
      if (choice === 'cancel') return false;
      if (choice === 'save' && !(await this.save(tab))) return false;
    }
    const idx = this.tabs.indexOf(tab);
    this.tabs.splice(idx, 1);
    if (tab.kind === 'doc') void tab.pdfDoc?.destroy();
    tab.stageEl.remove();
    if (this.active === tab.id) {
      const next = this.tabs[idx] ?? this.tabs[idx - 1];
      this.activate(next ? next.id : 'home');
    } else {
      this.renderTabs();
    }
    return true;
  }

  /** Close guard for window/app close: offers to save every dirty document. */
  async confirmCloseAll(): Promise<boolean> {
    for (const tab of this.tabs) {
      if (tab.kind !== 'doc' || !tab.dirty) continue;
      this.activate(tab.id);
      const choice = await confirmUnsaved(tab.name);
      if (choice === 'cancel') return false;
      if (choice === 'save' && !(await this.save(tab))) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ documents

  openDocument({
    name,
    handle,
    data,
    dirty = false,
  }: {
    name: string;
    handle: string | null;
    data: Uint8Array;
    dirty?: boolean;
  }): DocTab {
    if (handle) {
      const existing = this.tabs.find(
        (t): t is DocTab => t.kind === 'doc' && t.handle === handle
      );
      if (existing) {
        this.activate(existing.id);
        return existing;
      }
    }
    const container = h(
      'div',
      { class: 'viewer-container', tabindex: '0' },
      h('div', { class: 'pdfViewer' })
    );
    const viewerLayer = h('div', { class: 'tab-stage' }, container);
    const tab: DocTab = {
      kind: 'doc',
      id: nextId(),
      name,
      handle,
      bytes: data,
      savedBytes: dirty ? null : data,
      dirty,
      history: [],
      future: [],
      tool: null,
      stageEl: h('div', { class: 'tab-stage' }, viewerLayer),
      viewerLayer,
      container,
    };
    $('#stage').append(tab.stageEl);
    this.tabs.push(tab);
    this.activate(tab.id);
    void this.load(tab);
    return tab;
  }

  /** Routes files from any source: PDFs open as documents, others go to a converter. */
  openFiles(files: OpenedDocument[]) {
    for (const f of files) {
      if (/\.pdf$/i.test(f.name) || isPdfBytes(f.data)) {
        this.openDocument({ name: f.name, handle: f.handle, data: f.data });
        continue;
      }
      const converter = converterFor(f.name);
      if (converter) {
        this.openToolTab(converter, { name: f.name, data: f.data });
        toast(`Opened “${f.name}” in ${tool(converter)!.name}`);
      } else {
        toast(`UnAcrobat can’t open “${f.name}”`, { error: true });
      }
    }
  }

  private async load(tab: DocTab) {
    const keepPage = tab.viewer?.pdfViewer.currentPageNumber;
    const keepScale = tab.viewer?.pdfViewer.currentScaleValue;
    tab.thumbs = null;

    let loading: HTMLElement | null = null;
    if (!tab.viewer) {
      loading = h(
        'div',
        { class: 'viewer-loading' },
        h('div', {}, h('div', { class: 'spinner' }), 'Opening…')
      );
      tab.viewerLayer.append(loading);
    }

    const task = pdfjs.getDocument({
      ...DOCUMENT_OPTIONS,
      data: tab.bytes.slice(),
    });
    task.onPassword = async (update: (pw: string) => void, reason: number) => {
      const pw = await askPassword(
        tab.name,
        reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD
      );
      if (pw == null) void task.destroy();
      else update(pw);
    };
    let pdfDoc;
    try {
      pdfDoc = await task.promise;
    } catch (err) {
      loading?.remove();
      const e = err as Error;
      const cancelled =
        e?.name === 'PasswordException' || /destroy/i.test(e?.message ?? '');
      if (!cancelled)
        toast(`Couldn’t open “${tab.name}”: ${e.message}`, {
          error: true,
          timeout: 8000,
        });
      if (!tab.pdfDoc) void this.closeTab(tab);
      return;
    }
    loading?.remove();
    const old = tab.pdfDoc;
    tab.pdfDoc = pdfDoc;

    if (!tab.viewer) {
      const isActive = () => tab === this.activeTab();
      const viewer = createViewer(tab.container, {
        onPagesInit: () => {
          viewer.pdfViewer.currentScaleValue = tab.restoreScale || 'auto';
          if (tab.restorePage) {
            viewer.pdfViewer.currentPageNumber = Math.min(
              tab.restorePage,
              viewer.pdfViewer.pagesCount
            );
          }
          tab.restoreScale = tab.restorePage = null;
          if (isActive()) this.syncChrome();
        },
        onPageChange: () => {
          if (!isActive()) return;
          this.syncPageUI();
          if (this.panel === 'thumbnails') highlightThumb(tab);
        },
        onScaleChange: () => isActive() && this.syncZoomUI(),
        onFindCount: (matches, notFound) => {
          if (!isActive()) return;
          $('#find-count').textContent = notFound
            ? 'No results'
            : matches?.total
              ? `${matches.current} of ${matches.total}`
              : '';
        },
      });
      tab.viewer = viewer;
    }
    tab.restorePage = keepPage;
    tab.restoreScale = keepScale;
    tab.viewer.pdfViewer.setDocument(pdfDoc);
    tab.viewer.linkService.setDocument(pdfDoc);
    void old?.destroy();
    if (tab === this.activeTab()) this.syncChrome();
  }

  applyEdit(tab: DocTab, bytes: Uint8Array) {
    tab.history.push(tab.bytes);
    if (tab.history.length > HISTORY_LIMIT) tab.history.shift();
    tab.future = [];
    this.setBytes(tab, bytes);
  }

  private setBytes(tab: DocTab, bytes: Uint8Array) {
    tab.bytes = bytes;
    tab.dirty = tab.bytes !== tab.savedBytes;
    void this.load(tab);
    this.renderTabs();
  }

  async save(tab: DocTab | null, { as = false } = {}): Promise<boolean> {
    if (!tab) return false;
    try {
      if (as || !tab.handle || !this.host.capabilities.saveInPlace) {
        const saved = await this.host.saveAs(
          tab.name.replace(/\.pdf$/i, '') + '.pdf',
          tab.bytes
        );
        if (!saved) return false;
        tab.handle = saved.handle;
        tab.name = saved.name;
      } else {
        await this.host.save(tab.handle, tab.bytes);
      }
    } catch (err) {
      toast(`Save failed: ${(err as Error).message ?? err}`, {
        error: true,
        timeout: 8000,
      });
      return false;
    }
    tab.savedBytes = tab.bytes;
    tab.dirty = false;
    if (tab === this.activeTab()) this.activate(tab.id);
    else this.renderTabs();
    toast(`Saved “${tab.name}”`);
    return true;
  }

  async exportFile(name: string, data: Uint8Array) {
    try {
      const saved = await this.host.exportFile(name, data);
      if (saved) toast(`Saved ${saved}`);
    } catch (err) {
      toast(`Couldn’t save “${name}”: ${(err as Error).message ?? err}`, {
        error: true,
        timeout: 8000,
      });
    }
  }

  // ------------------------------------------------------------------ undo / redo

  /** The document whose focused field owns the keyboard, if any. */
  private editableFocus(): Document | null {
    let el = document.activeElement;
    let doc: Document = document;
    while (el?.tagName === 'IFRAME') {
      try {
        const inner = (el as HTMLIFrameElement).contentDocument;
        if (!inner) break;
        doc = inner;
        el = inner.activeElement;
      } catch {
        break;
      }
    }
    const html = el as HTMLElement | null;
    if (
      html &&
      (html.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(html.tagName))
    )
      return doc;
    // Tools with their own canvas editors own the keyboard while open.
    const tab = this.activeTab();
    if (tab?.kind === 'tool' || (tab?.kind === 'doc' && tab.tool)) return doc;
    return null;
  }

  undo(tab: DocTab | null = this.activeDoc()) {
    if (tab === this.activeTab()) {
      const doc = this.editableFocus();
      if (doc) return void doc.execCommand('undo');
    }
    if (!tab?.history.length) return;
    tab.future.push(tab.bytes);
    this.setBytes(tab, tab.history.pop()!);
    this.syncChrome();
  }

  redo(tab: DocTab | null = this.activeDoc()) {
    const doc = this.editableFocus();
    if (doc) return void doc.execCommand('redo');
    if (!tab?.future.length) return;
    tab.history.push(tab.bytes);
    this.setBytes(tab, tab.future.pop()!);
    this.syncChrome();
  }

  revert() {
    const tab = this.activeDoc();
    if (tab?.savedBytes && tab.dirty) this.applyEdit(tab, tab.savedBytes);
  }

  // ------------------------------------------------------------------ tools

  private toolHeader(toolId: string, subtitle: string, onClose?: () => void) {
    const t = tool(toolId)!;
    return h(
      'div',
      { class: 'tool-header' },
      h(
        'div',
        { class: 't-icon', style: `background:${t.color}` },
        icon(t.icon)
      ),
      h(
        'div',
        { style: 'min-width:0' },
        h('div', { class: 't-title' }, t.name),
        h('div', { class: 't-sub' }, subtitle)
      ),
      h('div', { class: 'spacer' }),
      onClose
        ? h(
            'button',
            { class: 'btn sm', onclick: onClose },
            icon('ph-x'),
            'Close tool'
          )
        : null
    );
  }

  runTool(toolId: string) {
    const tab = this.activeDoc();
    if (tab) this.runToolOnDoc(tab, toolId);
    else this.openToolTab(toolId);
  }

  runToolOnDoc(tab: DocTab, toolId: string) {
    if (!takesPdf(toolId)) return this.openToolTab(toolId);
    if (tab.tool) this.closeTool(tab);
    const wrap = h('div', { class: 'tool-frame-wrap' });
    const layer = h(
      'div',
      { class: 'tab-stage' },
      this.toolHeader(
        toolId,
        `Working on “${tab.name}” · Results come back into this document`,
        () => this.closeTool(tab)
      ),
      wrap
    );
    tab.viewerLayer.hidden = true;
    tab.stageEl.append(layer);
    const file = {
      name: tab.name.endsWith('.pdf') ? tab.name : `${tab.name}.pdf`,
      data: tab.bytes,
    };
    const frame = mountToolFrame(wrap, toolId, file, {
      onLeave: () => this.closeTool(tab),
      onOpenTool: (id) => this.openToolTab(id),
    });
    tab.tool = { id: toolId, layer, frame };
    this.syncChrome();
  }

  closeTool(tab: DocTab) {
    if (!tab.tool) return;
    tab.tool.layer.remove();
    tab.tool = null;
    tab.viewerLayer.hidden = false;
    if (tab === this.activeTab()) this.syncChrome();
  }

  openToolTab(toolId: string, file?: FrameFile) {
    if (!hasTool(toolId)) return;
    if (!file) {
      const existing = this.tabs.find(
        (t) => t.kind === 'tool' && t.toolId === toolId
      );
      if (existing) return this.activate(existing.id);
    }
    const id = nextId();
    const wrap = h('div', { class: 'tool-frame-wrap' });
    const stageEl = h(
      'div',
      { class: 'tab-stage' },
      this.toolHeader(toolId, tool(toolId)!.subtitle),
      wrap
    );
    $('#stage').append(stageEl);
    const frame = mountToolFrame(wrap, toolId, file, {
      onLeave: () => {
        const self = this.tabs.find((t) => t.id === id);
        if (self) void this.closeTab(self);
      },
      onOpenTool: (other) => this.openToolTab(other),
    });
    const tab: ToolTab = { kind: 'tool', id, toolId, stageEl, frame };
    this.tabs.push(tab);
    this.activate(tab.id);
  }

  /** A tool page produced a file. `source` is the frame's window. */
  receiveOutput(output: { name: string; data: Uint8Array }, source: Window) {
    const isPdf = /\.pdf$/i.test(output.name) || isPdfBytes(output.data);
    if (!isPdf) return void this.exportFile(output.name, output.data);

    const origin = this.tabs.find(
      (t): t is DocTab =>
        t.kind === 'doc' && t.tool?.frame.contentWindow === source
    );
    if (origin?.tool && !NEW_DOCUMENT_TOOLS.has(origin.tool.id)) {
      const name = tool(origin.tool.id)?.name ?? 'Tool';
      this.closeTool(origin); // the viewer must be visible before it reloads
      this.applyEdit(origin, output.data);
      this.activate(origin.id);
      toast(`${name} applied to “${origin.name}”`, {
        actions: [
          { label: 'Undo', run: () => this.undo(origin) },
          { label: 'Save', run: () => void this.save(origin) },
        ],
        timeout: 8000,
      });
      return;
    }
    const doc = this.openDocument({
      name: output.name,
      handle: null,
      data: output.data,
      dirty: true,
    });
    toast(`Opened result “${output.name}” — not saved yet`, {
      actions: [
        { label: 'Save As…', run: () => void this.save(doc, { as: true }) },
      ],
      timeout: 8000,
    });
  }

  // ------------------------------------------------------------------ chrome

  syncChrome() {
    const tab = this.activeTab();
    const doc = tab?.kind === 'doc' ? tab : null;
    const bar = $('#doc-toolbar');
    bar.classList.toggle('tool-mode', !doc || !!doc.tool);
    $('#tools-pane').classList.toggle(
      'collapsed',
      !this.leftPane || tab?.kind === 'tool'
    );
    $('#quick-rail').hidden = tab?.kind === 'tool';
    for (const cmd of ['save', 'print', 'undo', 'redo', 'share-export']) {
      const b = bar.querySelector<HTMLButtonElement>(`[data-cmd="${cmd}"]`)!;
      b.disabled =
        !doc ||
        (cmd === 'undo' && !doc.history.length) ||
        (cmd === 'redo' && !doc.future.length);
    }
    const showPanel = !!doc && !!this.panel;
    $('#side-panel').hidden = !showPanel;
    $('#right-rail').hidden = !doc;
    const runningTool = doc?.tool?.id;
    document
      .querySelectorAll<HTMLElement>('#right-rail .rail-btn')
      .forEach((b) => b.classList.toggle('on', b.dataset.panel === this.panel));
    document
      .querySelectorAll<HTMLElement>('#quick-rail .rail-btn')
      .forEach((b) => b.classList.toggle('on', b.dataset.tool === runningTool));
    document
      .querySelectorAll<HTMLElement>('#pane-list .pane-tool')
      .forEach((b) =>
        b.classList.toggle('active', b.dataset.tool === runningTool)
      );
    if (showPanel) void renderPanel(doc, this.panel!, this.panelActions);
    if (doc?.viewer) {
      this.syncPageUI();
      this.syncZoomUI();
    }
  }

  private get panelActions() {
    return {
      openAttachment: (name: string, data: Uint8Array) =>
        void this.openDocument({ name, handle: null, data, dirty: true }),
      exportAttachment: (name: string, data: Uint8Array) =>
        void this.exportFile(name, data),
      runTool: (tab: DocTab, id: string) => this.runToolOnDoc(tab, id),
      reveal: this.host.capabilities.revealFile
        ? (handle: string) => void this.host.revealFile(handle)
        : undefined,
      openExternal: (url: string) => void this.host.openExternal(url),
    };
  }

  syncPageUI() {
    const v = this.activeDoc()?.viewer?.pdfViewer;
    if (!v) return;
    const input = $<HTMLInputElement>('#page-input');
    if (document.activeElement !== input)
      input.value = String(v.currentPageNumber);
    $('#page-count').textContent = `/ ${v.pagesCount}`;
  }

  syncZoomUI() {
    const v = this.activeDoc()?.viewer?.pdfViewer;
    if (!v) return;
    const sel = $<HTMLSelectElement>('#zoom-select');
    const opt = [...sel.options].find(
      (o) => o.value === String(v.currentScaleValue)
    );
    if (opt && opt.value !== 'custom') sel.value = opt.value;
    else {
      sel.querySelector('[value=custom]')!.textContent =
        `${Math.round(v.currentScale * 100)}%`;
      sel.value = 'custom';
    }
  }

  togglePanel(name: PanelName | null) {
    this.panel = this.panel === name ? null : name;
    store('panel', this.panel ?? '');
    this.syncChrome();
  }

  toggleLeftPane() {
    this.leftPane = !this.leftPane;
    store('leftPane', this.leftPane ? 'open' : 'closed');
    this.syncChrome();
  }

  // ------------------------------------------------------------------ viewer commands

  zoom(value: 'in' | 'out' | string | number) {
    const v = this.activeDoc()?.viewer?.pdfViewer;
    if (!v) return;
    if (value === 'in') v.increaseScale();
    else if (value === 'out') v.decreaseScale();
    else v.currentScaleValue = String(value);
  }

  rotate(delta: number) {
    const v = this.activeDoc()?.viewer?.pdfViewer;
    if (v) v.pagesRotation = (v.pagesRotation + delta + 360) % 360;
  }

  spread(mode?: string) {
    const v = this.activeDoc()?.viewer?.pdfViewer;
    if (!v) return;
    const modes: Record<string, number> = { single: 0, odd: 1, even: 2 };
    v.spreadMode = mode && mode in modes ? modes[mode] : (v.spreadMode + 1) % 3;
  }

  find(again: boolean, previous = false) {
    const viewer = this.activeDoc()?.viewer;
    if (!viewer) return;
    const query = $<HTMLInputElement>('#find-input').value;
    if (!query) $('#find-count').textContent = '';
    find(viewer, query, again, previous);
  }

  print() {
    const pdf = this.activeDoc()?.pdfDoc;
    if (!pdf) return;
    void printDocument(pdf, (n) =>
      toast(`Preparing ${n} page${n > 1 ? 's' : ''} for printing…`, {
        timeout: 2500,
      })
    );
  }

  exportMenu(anchor: HTMLElement) {
    const tab = this.activeDoc();
    if (!tab) return;
    const run = (id: string) => () => this.runToolOnDoc(tab, id);
    popMenu(anchor, [
      {
        label: 'Save a copy…',
        icon: 'ph-copy',
        run: () => void this.host.saveAs(tab.name, tab.bytes),
      },
      {
        label: 'Export to Word (.docx)',
        icon: 'ph-file-doc',
        run: run('pdf-to-word'),
      },
      {
        label: 'Export to Excel (.xlsx)',
        icon: 'ph-file-xls',
        run: run('pdf-to-excel'),
      },
      {
        label: 'Export to images (PNG)',
        icon: 'ph-file-png',
        run: run('pdf-to-png'),
      },
      {
        label: 'Export to images (JPG)',
        icon: 'ph-file-jpg',
        run: run('pdf-to-jpg'),
      },
      {
        label: 'Export to text',
        icon: 'ph-file-text',
        run: run('pdf-to-text'),
      },
      {
        label: 'Export to Markdown',
        icon: 'ph-markdown-logo',
        run: run('pdf-to-markdown'),
      },
      { label: 'Save as PDF/A', icon: 'ph-archive', run: run('pdf-to-pdfa') },
    ]);
  }
}
