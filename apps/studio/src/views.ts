import {
  $,
  formatBytes,
  h,
  icon,
  locationOf,
  storage,
  store,
  timeAgo,
} from './dom.ts';
import {
  CATEGORIES,
  CATEGORY_STYLE,
  POPULAR,
  QUICK_RAIL,
  RECOMMENDED,
  tool,
  type Shortcut,
  type Tool,
} from './catalog.ts';
import type { Studio } from './studio.ts';
import { toast } from './ui/feedback.ts';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const matches = (q: string) => (t: Tool) =>
  !q || `${t.name} ${t.subtitle}`.toLowerCase().includes(q);

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

  const recCard = ([id, label, ic]: Shortcut) => {
    const t = tool(id);
    return t
      ? h(
          'button',
          { class: 'rec-card', onclick: () => studio.openToolTab(id) },
          h(
            'div',
            { class: 'rec-icon', style: `background:${t.color}` },
            icon(ic)
          ),
          h('strong', {}, label),
          h('span', {}, t.subtitle)
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
  const open = async (handle: string) => {
    const doc = await host.openRecent(handle);
    if (doc) studio.openFiles([doc]);
    else toast('That file is no longer available', { error: true });
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
              void open(r.handle);
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
    const sections: HTMLElement[] = [];
    const seen = new Set<string>();
    for (const cat of CATEGORIES) {
      const tools = cat.tools.filter((t) => match(t) && !(q && seen.has(t.id)));
      tools.forEach((t) => seen.add(t.id));
      if (!tools.length) continue;
      sections.push(
        h('h2', { id: `cat-${slug(cat.name)}` }, cat.name),
        h(
          'div',
          { class: 'tool-grid' },
          tools.map((t) =>
            h(
              'button',
              {
                class: 'tool-card',
                title: t.subtitle,
                onclick: () => studio.openToolTab(t.id),
              },
              h(
                'div',
                {
                  class: 't-icon',
                  style: `background:${tool(t.id)?.color ?? '#555'}`,
                },
                icon(t.icon)
              ),
              h('div', {}, h('strong', {}, t.name), h('span', {}, t.subtitle))
            )
          )
        )
      );
    }
    $('#tools-main').replaceChildren(
      ...(sections.length
        ? sections
        : [
            h(
              'div',
              { class: 'empty' },
              icon('ph-magnifying-glass'),
              `No tools match “${q}”`
            ),
          ])
    );
    $('#tools-cats').replaceChildren(
      ...CATEGORIES.map((cat) =>
        h(
          'button',
          {
            class: 'cat-link',
            onclick: () =>
              document
                .getElementById(`cat-${slug(cat.name)}`)
                ?.scrollIntoView({ behavior: 'smooth' }),
          },
          cat.name,
          h('small', {}, cat.tools.filter(match).length)
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
      const [id, label, ic] = item;
      return h(
        'button',
        {
          class: 'rail-btn',
          'data-tip': label,
          dataset: { tool: id },
          onclick: () => studio.runTool(id),
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

  const openCats = new Set<string>(
    JSON.parse(
      storage('openCats') ?? '["Edit & Annotate","Organize & Manage"]'
    ) as string[]
  );
  const renderList = () => {
    const q = $<HTMLInputElement>('#pane-search').value.trim().toLowerCase();
    const match = matches(q);
    $('#pane-list').replaceChildren(
      ...CATEGORIES.filter((c) => c.name !== POPULAR).flatMap((cat) => {
        const tools = cat.tools.filter(match);
        if (!tools.length) return [];
        const style = CATEGORY_STYLE[cat.name] ?? {
          color: '#555',
          icon: 'ph-wrench',
        };
        const el = h(
          'div',
          { class: `pane-cat${q || openCats.has(cat.name) ? ' open' : ''}` },
          h(
            'button',
            {
              onclick: () => {
                el.classList.toggle('open');
                if (el.classList.contains('open')) openCats.add(cat.name);
                else openCats.delete(cat.name);
                store('openCats', JSON.stringify([...openCats]));
              },
            },
            h(
              'span',
              { class: 'cat-icon', style: `background:${style.color}` },
              icon(style.icon)
            ),
            cat.name,
            icon('ph-caret-right', 'ph caret')
          ),
          h(
            'ul',
            {},
            tools.map((t) =>
              h(
                'li',
                {},
                h(
                  'button',
                  {
                    class: 'pane-tool',
                    title: t.subtitle,
                    dataset: { tool: t.id },
                    onclick: () => studio.runTool(t.id),
                  },
                  icon(t.icon),
                  t.name
                )
              )
            )
          )
        );
        return [el];
      })
    );
    studio.syncChrome();
  };
  $('#pane-search').addEventListener('input', renderList);
  renderList();
}
