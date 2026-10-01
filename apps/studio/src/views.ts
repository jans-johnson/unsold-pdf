/* global __UNSOLD_VERSION__ */
import { $, formatBytes, h, icon, locationOf, timeAgo } from './dom.ts';
import {
  GROUPS,
  QUICK_RAIL,
  RECOMMENDED,
  resolve,
  searchText,
  type Shortcut,
  type Task,
} from './tasks.ts';
import type { Studio } from './studio.ts';
import { toast } from './ui/feedback.ts';
import { openReportDialog } from './support.ts';

const SUPPORT_URL = 'https://buymeacoffee.com/jansjohnson';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const matches = (q: string) => (t: Task) => !q || searchText(t).includes(q);
const taskIcon = (t: { color: string; icon: string }, cls: string) =>
  h('span', { class: cls, style: `background:${t.color}` }, icon(t.icon));

// ------------------------------------------------------------------ home

export function mountHome(studio: Studio) {
  const { host } = studio;
  const hour = new Date().getHours();
  $('#greeting').textContent =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('#home-privacy').textContent = `Every tool runs locally on this ${
    host.platform === 'android' || host.platform === 'ios'
      ? 'device'
      : 'computer'
  }. Your files never leave it.`;

  $('#app-version').textContent = `Version ${__UNSOLD_VERSION__}`;

  // App-store builds leave the tip link out (see HostCapabilities.tips).
  const support = $<HTMLAnchorElement>('#support-link');
  support.hidden = !host.capabilities.tips;
  support.addEventListener('click', (e) => {
    e.preventDefault();
    void host.openExternal(SUPPORT_URL);
  });

  const recCard = ([target, label, ic]: Shortcut) => {
    const r = resolve(target);
    return r
      ? h(
          'button',
          { class: 'rec-card', onclick: () => studio.openToolTab(target) },
          h(
            'div',
            { class: 'rec-icon', style: `background:${r.task.color}` },
            icon(ic)
          ),
          h('strong', {}, label),
          h('span', {}, r.task.summary)
        )
      : null;
  };
  $('#recommended').replaceChildren(
    ...RECOMMENDED.map(recCard).filter((c): c is HTMLButtonElement => !!c)
  );

  const pick = async () => studio.openFiles(await host.pickDocuments());
  $('#home-open').onclick = pick;
  $('#home-open-2').onclick = pick;
  $('#title-open').onclick = pick;
  $('#recent-filter').oninput = () => void renderRecents(studio);
  $('#recent-clear').onclick = async () => {
    await host.clearRecents();
    void renderRecents(studio);
  };
  studio.onHomeShown = () => void renderRecents(studio);
}

async function renderRecents(studio: Studio) {
  const { host } = studio;
  const list = await host.listRecents();
  const q = $<HTMLInputElement>('#recent-filter').value.trim().toLowerCase();
  const rows = list.filter((r) => !q || r.name.toLowerCase().includes(q));
  const table = $('#recent-table');
  if (!rows.length) {
    table.replaceChildren(
      h(
        'div',
        { class: 'empty' },
        icon('ph-clock-counter-clockwise'),
        q
          ? 'No recent files match your filter'
          : 'Files you open will appear here'
      )
    );
    return;
  }
  const open = async (r: (typeof rows)[number]) => {
    const doc = await host.openRecent(r.handle).catch(() => null);
    if (doc) return studio.openFiles([doc]);
    toast(
      `Can’t open “${r.name}”. It may have moved, or access to it has ended. Open it again from where it’s stored.`,
      {
        error: true,
        timeout: 10000,
        actions: [
          {
            label: 'Remove from recent',
            run: () =>
              void host
                .removeRecent(r.handle)
                .then(() => renderRecents(studio)),
          },
        ],
      }
    );
  };
  table.replaceChildren(
    h(
      'div',
      { class: 'recent-row head' },
      h('span'),
      h('span', {}, 'Name'),
      h('span', {}, 'Location'),
      h('span', {}, 'Size'),
      h('span', {}, 'Opened'),
      h('span')
    ),
    ...rows.map((r) =>
      h(
        'div',
        {
          class: `recent-row${r.exists ? '' : ' missing'}`,
          title: r.exists ? r.handle : 'File not found',
          onclick: (e: Event) => {
            if (!(e.target as Element).closest('.row-actions') && r.exists)
              void open(r);
          },
        },
        icon('ph-file-pdf', 'ph-fill file-ico'),
        h('span', { class: 'name' }, r.name),
        h('span', { class: 'loc' }, h('bdi', {}, locationOf(r.handle))),
        h('span', { class: 'meta' }, formatBytes(r.size)),
        h('span', { class: 'meta' }, timeAgo(r.openedAt)),
        h(
          'span',
          { class: 'row-actions' },
          r.exists && host.capabilities.revealFile
            ? h(
                'button',
                {
                  class: 'icon-btn sm',
                  title: 'Show in folder',
                  onclick: () => void host.revealFile(r.handle),
                },
                icon('ph-folder')
              )
            : null,
          h(
            'button',
            {
              class: 'icon-btn sm',
              title: 'Remove from recent',
              onclick: async () => {
                await host.removeRecent(r.handle);
                void renderRecents(studio);
              },
            },
            icon('ph-x')
          )
        )
      )
    )
  );
}

// ------------------------------------------------------------------ all tools

export function mountToolsView(studio: Studio) {
  const render = () => {
    const q = $<HTMLInputElement>('#tools-search').value.trim().toLowerCase();
    const match = matches(q);
    const sections = GROUPS.flatMap((group) => {
      const tasks = group.tasks.filter(match);
      if (!tasks.length) return [];
      return [
        h('h2', { id: `group-${slug(group.name)}` }, group.name),
        h(
          'div',
          { class: 'task-grid' },
          tasks.map((task) =>
            h(
              'div',
              {
                class: 'task-card',
                role: 'button',
                tabindex: '0',
                onclick: () => studio.openToolTab(task.id),
                onkeydown: (e: KeyboardEvent) => {
                  if (e.key === 'Enter') studio.openToolTab(task.id);
                },
              },
              h(
                'div',
                { class: 'task-card-head' },
                taskIcon(task, 't-icon'),
                h(
                  'div',
                  {},
                  h('strong', {}, task.name),
                  h('span', {}, task.summary)
                )
              ),
              task.modes.length > 1
                ? h(
                    'div',
                    { class: 'chips' },
                    task.modes.map((m) =>
                      h(
                        'button',
                        {
                          class: 'chip',
                          onclick: (e: Event) => {
                            e.stopPropagation();
                            studio.openToolTab(m.tool);
                          },
                        },
                        m.label
                      )
                    )
                  )
                : null
            )
          )
        ),
      ];
    });
    $('#tools-main').replaceChildren(
      ...(sections.length
        ? sections
        : [
            h(
              'div',
              { class: 'empty' },
              icon('ph-magnifying-glass'),
              `Nothing matches “${q}”`
            ),
          ])
    );
    $('#tools-cats').replaceChildren(
      ...GROUPS.map((group) =>
        h(
          'button',
          {
            class: 'cat-link',
            onclick: () =>
              document
                .getElementById(`group-${slug(group.name)}`)
                ?.scrollIntoView({ behavior: 'smooth' }),
          },
          h('span', { class: 'cat-dot', style: `background:${group.color}` }),
          group.name,
          h('small', {}, group.tasks.filter(match).length)
        )
      )
    );
  };
  $('#tools-search').addEventListener('input', render);
  render();
}

// ------------------------------------------------------------------ document panes

export function mountDocumentPanes(studio: Studio) {
  $('#quick-rail').replaceChildren(
    ...QUICK_RAIL.map((item) => {
      if (!item) return h('div', { class: 'rail-sep' });
      const [target, label, ic] = item;
      return h(
        'button',
        {
          class: 'rail-btn',
          'data-tip': label,
          dataset: { target },
          onclick: () => studio.runTool(target),
        },
        icon(ic)
      );
    }),
    h('div', { class: 'rail-sep' }),
    h(
      'button',
      {
        class: 'rail-btn',
        'data-tip': 'All tools',
        onclick: () => studio.toggleLeftPane(),
      },
      icon('ph-dots-three-outline')
    )
  );

  const renderList = () => {
    const q = $<HTMLInputElement>('#pane-search').value.trim().toLowerCase();
    const match = matches(q);
    $('#pane-list').replaceChildren(
      ...GROUPS.flatMap((group) => {
        const tasks = group.tasks.filter(match);
        if (!tasks.length) return [];
        return [
          h('div', { class: 'pane-group' }, group.name),
          ...tasks.map((task) =>
            h(
              'button',
              {
                class: 'pane-tool',
                title: task.summary,
                dataset: { task: task.id },
                onclick: () => studio.runTool(task.id),
              },
              taskIcon(task, 'pane-icon'),
              task.name
            )
          ),
        ];
      }),
      // Problems can always be reported from here (every build has it).
      q
        ? ''
        : h(
            'button',
            {
              class: 'pane-support',
              title: 'Tell us what went wrong',
              onclick: () => void openReportDialog(studio),
            },
            icon('ph-bug'),
            'Report a problem'
          ),
      // A quiet way to say thanks, at the very end of the list only.
      q || !studio.host.capabilities.tips
        ? ''
        : h(
            'button',
            {
              class: 'pane-support',
              title: 'Unsold is free. If it helps you, buy me a coffee.',
              onclick: () => void studio.host.openExternal(SUPPORT_URL),
            },
            icon('ph-coffee'),
            'Support Unsold'
          )
    );
    studio.syncChrome();
  };
  $('#pane-search').addEventListener('input', renderList);
  renderList();
}
