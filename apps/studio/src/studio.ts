import {
  toolPageState,
  type HostBridge,
  type OpenedDocument,
} from '@unsold/bridge';
import { $, h, icon, isPdfBytes, nextId, storage, store } from './dom.ts';
import {
  canRun,
  converterFor,
  MULTI_INPUT_TOOLS,
  NEW_DOCUMENT_TOOLS,
  takesPdf,
  tool,
} from './catalog.ts';
import { mountCreatePanel, mountToolFrame, type FrameFile } from './frames.ts';
import {
  highlightThumb,
  printDocument,
  renderPanel,
  type PanelName,
} from './panels.ts';
import { DOCUMENT_OPTIONS, pdfjs } from './pdf.ts';
import { HISTORY_LIMIT, type DocTab, type Tab, type ToolTab } from './tabs.ts';
import {
  askPassword,
  confirmApply,
  confirmUnsaved,
  popMenu,
  toast,
} from './ui/feedback.ts';
import {
  convertibleFormats,
  CREATE_FROM_FILES,
  modeLabel,
  resolve,
  type Resolved,
} from './tasks.ts';
import { createViewer, find } from './viewer.ts';

type View = 'home' | 'tools';

/** Owns the open tabs and everything that happens to a document. */
/** Whether a PDF is encrypted (its trailer, near the start or end, names /Encrypt). */
function hasEncryption(bytes: Uint8Array) {
  const text = (part: Uint8Array) => new TextDecoder('latin1').decode(part);
  const edge = 64 * 1024;
  return /\/Encrypt\b/.test(
    text(bytes.subarray(0, edge)) + text(bytes.subarray(-edge))
  );
}

/** Phone-sized window: the layout shows one pane at a time (see styles.css). */
const isPhone = () => matchMedia('(max-width: 760px)').matches;

export class Studio {
  tabs: Tab[] = [];
  active: View | string = 'home';
  // On phones the pane is a full-screen sheet, so it starts closed there.
  leftPane = !isPhone() && storage('leftPane') !== 'closed';
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
        const task = isDoc ? null : resolve(t.taskId)?.task;
        const label = isDoc ? t.name : (t.label ?? task?.name ?? t.taskId);
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
            : icon(task?.icon ?? 'ph-wrench', 'ph tab-icon-tool'),
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
        : (tab.label ?? resolve(tab.taskId)?.task.name)
      : id === 'tools'
        ? 'All tools'
        : 'Home';
    void this.host.setTitle(`${title} — Unsold PDF`);
  }

  async closeTab(tab: Tab): Promise<boolean> {
    const frame = tab.kind === 'doc' ? tab.tool?.frame : tab.frame;
    if (!(await this.leaveFrame(frame))) return false;
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
      const frame = tab.kind === 'doc' ? tab.tool?.frame : tab.frame;
      if (toolPageState(frame?.contentWindow)?.hasChanges()) {
        this.activate(tab.id);
        if (!(await this.leaveFrame(frame))) return false;
      }
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
      if (converter && !canRun(converter)) {
        toast(
          `“${f.name}” can’t be converted on this device. Office files convert in Unsold PDF for Mac, Windows and Linux, or on the web.`,
          { error: true, timeout: 10000 }
        );
      } else if (converter) {
        this.openToolTab(converter, { name: f.name, data: f.data });
        toast(`Opened “${f.name}” in ${tool(converter)!.name}`);
      } else {
        toast(`Unsold PDF can’t open “${f.name}”`, { error: true });
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
      else {
        tab.password = pw;
        update(pw);
      }
    };
    let pdfDoc;
    try {
      pdfDoc = await task.promise;
    } catch (err) {
      loading?.remove();
      const e = err as Error;
      const cancelled =
        e?.name === 'PasswordException' || /destroy/i.test(e?.message ?? '');
      if (!cancelled) {
        const broken = { name: tab.name, data: tab.bytes };
        toast(`Couldn’t open “${tab.name}”: ${e.message}`, {
          error: true,
          timeout: 12000,
          actions: [
            {
              label: 'Try to repair',
              run: () => this.openToolTab('repair-pdf', broken),
            },
          ],
        });
      }
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
          viewer.pdfViewer.currentScaleValue =
            tab.restoreScale || (isPhone() ? 'page-width' : 'auto');
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

  /**
   * The header + content area for a running task. Switching modes swaps the
   * tool page in place; the Studio's own "from files" picker is a mode too.
   */
  private buildSurface(
    start: Resolved,
    opts: {
      subtitle: string;
      file?: FrameFile;
      onClose?: () => void;
      onLeave: () => void;
      /** Return false to handle the switch elsewhere (e.g. a tool that needs no PDF). */
      onSwitch?: (toolId: string) => boolean;
      onMount: (toolId: string, frame: HTMLIFrameElement | null) => void;
    }
  ): HTMLElement {
    const { task } = start;
    const wrap = h('div', { class: 'tool-frame-wrap' });
    const modes = task.modes.some((m) => m.tool === start.tool)
      ? task.modes
      : [{ tool: start.tool, label: modeLabel(start) }, ...task.modes];

    let current: { tool: string; frame: HTMLIFrameElement | null } = {
      tool: start.tool,
      frame: null,
    };
    const markActive = (toolId: string) => {
      switcher
        .querySelectorAll<HTMLElement>('[data-mode]')
        .forEach((b) => b.classList.toggle('on', b.dataset.mode === toolId));
      const select = switcher.querySelector('select');
      if (select) select.value = toolId;
    };
    const mount = (toolId: string) => {
      const frame =
        toolId === CREATE_FROM_FILES
          ? (mountCreatePanel(wrap, {
              pick: async () => this.openFiles(await this.host.pickDocuments()),
              formats: convertibleFormats(),
            }),
            null)
          : mountToolFrame(
              wrap,
              toolId,
              opts.file && {
                ...opts.file,
                only: opts.file.only && !MULTI_INPUT_TOOLS.has(toolId),
              },
              {
                onLeave: opts.onLeave,
                onOpenTool: (id) => this.openToolTab(id),
              }
            );
      current = { tool: toolId, frame };
      opts.onMount(toolId, frame);
      markActive(toolId);
    };
    const choose = async (toolId: string) => {
      if (toolId === current.tool) return;
      if (!(await this.leaveFrame(current.frame)))
        return markActive(current.tool);
      if (opts.onSwitch && !opts.onSwitch(toolId))
        return markActive(current.tool);
      mount(toolId);
    };

    const switcher =
      modes.length <= 1
        ? h('div')
        : modes.length <= 6
          ? h(
              'div',
              { class: 'mode-switch', role: 'tablist' },
              modes.map((m) =>
                h(
                  'button',
                  {
                    class: 'mode-btn',
                    role: 'tab',
                    dataset: { mode: m.tool },
                    title: tool(m.tool)?.subtitle ?? '',
                    onclick: () => void choose(m.tool),
                  },
                  m.label
                )
              )
            )
          : h(
              'label',
              { class: 'mode-select' },
              h('span', {}, task.modePicker ?? 'Mode'),
              h(
                'select',
                {
                  onchange: (e: Event) =>
                    void choose((e.target as HTMLSelectElement).value),
                },
                modes.map((m) => h('option', { value: m.tool }, m.label))
              )
            );

    const header = h(
      'div',
      { class: 'tool-header' },
      h(
        'div',
        { class: 't-icon', style: `background:${task.color}` },
        icon(task.icon)
      ),
      h(
        'div',
        { class: 't-head' },
        h('div', { class: 't-title' }, task.name),
        h('div', { class: 't-sub' }, opts.subtitle)
      ),
      switcher,
      h('div', { class: 'spacer' }),
      opts.onClose
        ? h(
            'button',
            { class: 'btn sm', onclick: opts.onClose },
            icon('ph-x'),
            'Close'
          )
        : null
    );
    const layer = h('div', { class: 'tab-stage' }, header, wrap);
    mount(start.tool);
    return layer;
  }

  /** Runs a task or tool: on the open document if there is one, else in its own tab. */
  runTool(id: string) {
    // The pane covers the document on phones; get it out of the way.
    if (isPhone() && this.leftPane) this.toggleLeftPane();
    const tab = this.activeDoc();
    if (tab) this.runToolOnDoc(tab, id);
    else this.openToolTab(id);
  }

  async runToolOnDoc(tab: DocTab, id: string) {
    const resolved = resolve(id);
    if (!resolved) return;
    if (!takesPdf(resolved.tool)) return this.openToolTab(id);
    if (tab.tool) {
      if (!(await this.leaveFrame(tab.tool.frame))) return;
      this.closeTool(tab);
    }
    const file = {
      name: tab.name.endsWith('.pdf') ? tab.name : `${tab.name}.pdf`,
      data: tab.bytes,
      only: true,
      password: tab.password,
    };
    // The first mount happens while buildSurface runs, before `layer` exists.
    let shown: { id: string; frame: HTMLIFrameElement | null } = {
      id: resolved.tool,
      frame: null,
    };
    const layer = this.buildSurface(resolved, {
      subtitle:
        resolved.task.id === 'export'
          ? `Exporting “${tab.name}” · saved as a separate file`
          : `Working on “${tab.name}” · results come back into this document`,
      file,
      onClose: () => void this.requestCloseTool(tab),
      onLeave: () => this.closeTool(tab),
      onSwitch: (toolId) => {
        if (takesPdf(toolId)) return true;
        this.openToolTab(toolId);
        return false;
      },
      onMount: (toolId, frame) => {
        shown = { id: toolId, frame };
        if (!tab.tool) return;
        tab.tool.id = toolId;
        tab.tool.frame = frame;
        if (tab === this.activeTab()) this.syncChrome();
      },
    });
    tab.tool = { ...shown, taskId: resolved.task.id, layer };
    tab.viewerLayer.hidden = true;
    tab.stageEl.append(layer);
    this.syncChrome();
  }

  /**
   * Before a tool page goes away: if it has unapplied changes, offer to
   * apply them. Resolves true when it is fine to leave now.
   */
  private async leaveFrame(frame: HTMLIFrameElement | null | undefined) {
    const state = toolPageState(frame?.contentWindow);
    if (!state?.hasChanges()) return true;
    const choice = await confirmApply();
    if (choice === 'discard') return true;
    // Applying delivers the result, which closes the tool by itself.
    if (choice === 'apply') await state.apply();
    return false;
  }

  /** Close button / the page's own back control. */
  async requestCloseTool(tab: DocTab) {
    if (tab.tool && (await this.leaveFrame(tab.tool.frame)))
      this.closeTool(tab);
  }

  /** A tool page asked to close (its back or done button). */
  requestCloseFrom(source: Window) {
    for (const tab of this.tabs) {
      if (tab.kind === 'doc' && tab.tool?.frame?.contentWindow === source) {
        return void this.requestCloseTool(tab);
      }
      if (tab.kind === 'tool' && tab.frame?.contentWindow === source) {
        return void this.closeTab(tab);
      }
    }
  }

  closeTool(tab: DocTab) {
    if (!tab.tool) return;
    tab.tool.layer.remove();
    tab.tool = null;
    tab.viewerLayer.hidden = false;
    if (tab === this.activeTab()) this.syncChrome();
  }

  openToolTab(id: string, file?: FrameFile) {
    const resolved = resolve(id);
    if (!resolved) return;
    if (!file) {
      const existing = this.tabs.find(
        (t): t is ToolTab => t.kind === 'tool' && t.taskId === resolved.task.id
      );
      if (existing) {
        this.activate(existing.id);
        if (existing.toolId !== resolved.tool && id !== resolved.task.id) {
          existing.stageEl
            .querySelector<HTMLElement>(`[data-mode="${resolved.tool}"]`)
            ?.click();
        }
        return;
      }
    }
    const tabId = nextId();
    const tab: ToolTab = {
      kind: 'tool',
      id: tabId,
      taskId: resolved.task.id,
      toolId: resolved.tool,
      label: file?.name,
      stageEl: h('div'),
      frame: null,
    };
    tab.stageEl = this.buildSurface(resolved, {
      subtitle: file ? `Converting “${file.name}”` : resolved.task.summary,
      file,
      onLeave: () => void this.closeTab(tab),
      onMount: (toolId, frame) => {
        tab.toolId = toolId;
        tab.frame = frame;
        if (tab === this.activeTab()) this.syncChrome();
      },
    });
    $('#stage').append(tab.stageEl);
    this.tabs.push(tab);
    this.activate(tab.id);
  }

  /** A tool page produced a file. `source` is the frame's window. */
  receiveOutput(
    output: { name: string; data: Uint8Array; asNew?: boolean },
    source: Window
  ) {
    const isPdf = /\.pdf$/i.test(output.name) || isPdfBytes(output.data);
    if (!isPdf) return void this.exportFile(output.name, output.data);

    const origin = this.tabs.find(
      (t): t is DocTab =>
        t.kind === 'doc' && t.tool?.frame?.contentWindow === source
    );
    if (
      origin?.tool &&
      !output.asNew &&
      !NEW_DOCUMENT_TOOLS.has(origin.tool.id)
    ) {
      const ran = resolve(origin.tool.id);
      const name = ran ? `${ran.task.name} (${modeLabel(ran)})` : 'Tool';
      this.closeTool(origin); // the viewer must be visible before it reloads
      this.applyEdit(origin, output.data);
      this.activate(origin.id);
      // Most tools write an unencrypted result; say so rather than letting
      // a protected document quietly lose its password.
      const unprotected = !!origin.password && !hasEncryption(output.data);
      if (unprotected) origin.password = undefined;
      const note = unprotected
        ? ' The result isn’t password-protected any more; use Protect to add a password again.'
        : '';
      toast(`${name} applied to “${origin.name}”.${note}`, {
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
        // While a tool is open it owns the document; its own undo applies.
        ((cmd === 'undo' || cmd === 'redo') && !!doc.tool) ||
        (cmd === 'undo' && !doc.history.length) ||
        (cmd === 'redo' && !doc.future.length);
    }
    const showPanel = !!doc && !!this.panel;
    $('#side-panel').hidden = !showPanel;
    $('#right-rail').hidden = !doc;
    const running =
      doc?.tool ??
      (tab?.kind === 'tool' ? { id: tab.toolId, taskId: tab.taskId } : null);
    const isRunning = (target?: string) =>
      !!running && (target === running.taskId || target === running.id);
    document
      .querySelectorAll<HTMLElement>('#right-rail .rail-btn')
      .forEach((b) => b.classList.toggle('on', b.dataset.panel === this.panel));
    document
      .querySelectorAll<HTMLElement>('#quick-rail .rail-btn')
      .forEach((b) => b.classList.toggle('on', isRunning(b.dataset.target)));
    document
      .querySelectorAll<HTMLElement>('#pane-list .pane-tool')
      .forEach((b) => b.classList.toggle('active', isRunning(b.dataset.task)));
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
    // On phones both are sheets over the document; show one at a time.
    if (isPhone() && this.panel && this.leftPane) this.leftPane = false;
    store('panel', this.panel ?? '');
    this.syncChrome();
  }

  toggleLeftPane() {
    this.leftPane = !this.leftPane;
    if (isPhone() && this.leftPane) this.panel = null;
    if (!isPhone()) store('leftPane', this.leftPane ? 'open' : 'closed');
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
