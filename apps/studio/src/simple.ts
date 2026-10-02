/**
 * Simple mode (the default on phones): the layout people already know from
 * phone PDF apps. Home is a list of recent files with an Open button; a
 * document has back, its name and search at the top, the page number over
 * the page, and four labelled actions at the bottom (Edit, Sign, Comment,
 * More). Power mode is the full Studio, one switch away in the ⋮ menu.
 *
 * Simple mode only changes what's shown on phone-sized screens (styles.css,
 * `[data-mode='simple']`); desktop always has the full layout.
 */
import { $, h, icon } from './dom.ts';
import { resolve } from './tasks.ts';
import type { Studio } from './studio.ts';
import type { DocTab } from './tabs.ts';
import { openAboutDialog, openReportDialog } from './support.ts';
import { popMenu, type MenuItem } from './ui/feedback.ts';

const MODE_KEY = 'unsold.mode';
const UNSOLD_URL = 'https://stayunsold.com';

export type Mode = 'simple' | 'power';

export function getMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'power' ? 'power' : 'simple';
  } catch {
    return 'simple';
  }
}

export function setMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* storage blocked: the choice lasts for this session */
  }
  document.documentElement.dataset.mode = mode;
}

/** True when the simple layout is what's on screen right now. */
export const simpleShown = () =>
  document.documentElement.dataset.mode === 'simple' &&
  matchMedia('(max-width: 760px)').matches;

export function mountSimple(studio: Studio) {
  document.documentElement.dataset.mode = getMode();
  const bar = $('#simple-bar');
  const pill = $('#page-pill');

  const menu = (anchor: HTMLElement, items: MenuItem[]) =>
    popMenu(anchor, [
      ...items,
      {
        label: 'Power mode (all tools)',
        icon: 'ph-sliders-horizontal',
        run: () => {
          setMode('power');
          studio.activate(studio.active);
        },
      },
      {
        label: 'Report a problem',
        icon: 'ph-bug',
        run: () => void openReportDialog(studio),
      },
      {
        label: 'About',
        icon: 'ph-info',
        run: () => void openAboutDialog(studio),
      },
      ...(studio.host.capabilities.tips
        ? [
            {
              label: 'About Unsold',
              icon: 'ph-globe-simple',
              run: () => void studio.host.openExternal(UNSOLD_URL),
            },
          ]
        : []),
    ]);

  const back = async (doc: DocTab | null) => {
    const tab = studio.activeTab();
    if (!tab) return;
    if (doc?.tool) await studio.requestCloseTool(doc);
    else await studio.closeTab(tab);
  };

  const render = () => {
    const tab = studio.activeTab();
    const doc = tab?.kind === 'doc' ? tab : null;
    document.documentElement.dataset.view = tab ? 'doc' : String(studio.active);
    if (!tab) {
      // Open floats just above Home's footer, whatever its height.
      requestAnimationFrame(() => {
        const foot = document.querySelector<HTMLElement>('.home-footer');
        document.documentElement.style.setProperty(
          '--footer-h',
          `${foot?.offsetHeight ?? 0}px`
        );
      });
    }
    if (!tab) {
      bar.replaceChildren(
        h('span', { class: 'simple-title' }, 'Unsold PDF'),
        h(
          'button',
          {
            class: 'icon-btn',
            title: 'More',
            onclick: (e: Event) => menu(e.currentTarget as HTMLElement, []),
          },
          icon('ph-dots-three-vertical')
        )
      );
      return;
    }
    const title =
      tab.kind === 'tool'
        ? (tab.label ?? resolve(tab.taskId)?.task.name ?? '')
        : tab.tool
          ? (resolve(tab.tool.taskId)?.task.name ?? tab.name)
          : tab.name;
    bar.replaceChildren(
      h(
        'button',
        { class: 'icon-btn', title: 'Back', onclick: () => void back(doc) },
        icon('ph-arrow-left')
      ),
      h('span', { class: 'simple-title' }, title),
      doc?.dirty && !doc.tool
        ? h(
            'button',
            { class: 'btn primary sm', onclick: () => void studio.save(doc) },
            'Save'
          )
        : '',
      doc && !doc.tool
        ? h(
            'button',
            {
              class: 'icon-btn',
              title: 'Find text',
              onclick: () => {
                $('#doc-toolbar').classList.add('finding');
                $<HTMLInputElement>('#find-input').focus();
              },
            },
            icon('ph-magnifying-glass')
          )
        : '',
      doc && !doc.tool
        ? h(
            'button',
            {
              class: 'icon-btn',
              title: 'More',
              onclick: (e: Event) => {
                const anchor = e.currentTarget as HTMLElement;
                menu(anchor, [
                  {
                    label: 'Save a copy',
                    icon: 'ph-copy',
                    run: () => void studio.saveCopy(doc),
                  },
                  {
                    label: 'Export (Word, images…)',
                    icon: 'ph-export',
                    run: () => studio.exportMenu(anchor),
                  },
                  {
                    label: 'Print',
                    icon: 'ph-printer',
                    run: () => studio.print(),
                  },
                  {
                    label: 'Page thumbnails',
                    icon: 'ph-squares-four',
                    run: () => studio.togglePanel('thumbnails'),
                  },
                  {
                    label: 'Document info',
                    icon: 'ph-info',
                    run: () => studio.togglePanel('properties'),
                  },
                ]);
              },
            },
            icon('ph-dots-three-vertical')
          )
        : ''
    );
  };

  // The four everyday actions; "More" holds the next most common few.
  const run = (id: string) => () => studio.runTool(id);
  const action = (label: string, ic: string, onclick: (e: Event) => void) =>
    h(
      'button',
      { class: 'simple-action', onclick },
      icon(ic),
      h('span', {}, label)
    );
  $('#simple-actions').replaceChildren(
    action('Edit', 'ph-pencil-simple', run('edit-pdf-text')),
    action('Sign', 'ph-signature', run('sign-pdf')),
    action('Comment', 'ph-chat-circle-text', run('edit-pdf')),
    action('More', 'ph-dots-three', (e) =>
      popMenu(e.currentTarget as HTMLElement, [
        { label: 'Organize pages', icon: 'ph-files', run: run('organize') },
        { label: 'Make smaller', icon: 'ph-arrows-in', run: run('compress') },
        { label: 'Add a password', icon: 'ph-lock-key', run: run('password') },
        {
          label: 'Convert to Word',
          icon: 'ph-file-doc',
          run: run('pdf-to-word'),
        },
        {
          label: 'Combine with other files',
          icon: 'ph-stack',
          run: run('merge-pdf'),
        },
        {
          label: 'Make text searchable (OCR)',
          icon: 'ph-scan',
          run: run('scan-ocr'),
        },
      ])
    )
  );

  const syncPill = () => {
    const v = studio.activeDoc()?.viewer?.pdfViewer;
    pill.textContent = v ? `${v.currentPageNumber} / ${v.pagesCount}` : '';
  };

  // Follow the Studio: re-render whenever its chrome or tabs change.
  const chrome = studio.syncChrome.bind(studio);
  studio.syncChrome = () => {
    chrome();
    render();
    syncPill();
  };
  const tabs = studio.renderTabs.bind(studio);
  studio.renderTabs = () => {
    tabs();
    render();
  };
  const pages = studio.syncPageUI.bind(studio);
  studio.syncPageUI = () => {
    pages();
    syncPill();
  };
  render();
}
