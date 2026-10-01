/* global __UNSOLD_VERSION__, __UNSOLD_BUILD__ */
/**
 * "Report a problem" and "A new version is available", as every Unsold app
 * must have them (Utility Apps/unsold/DESIGN.md §8). The logic is shared in
 * @unsold/support; this file is the Studio's dialogs for it.
 */
import type { HostBridge } from '@unsold/bridge';
import {
  autoCheckEnabled,
  browserEnvironment,
  checkForUpdate,
  collectDiagnostics,
  distributionLabel,
  formatReport,
  githubIssueUrl,
  mailtoUrl,
  reportTitle,
  setAutoCheck,
  skipVersion,
  type AppIdentity,
  type Diagnostic,
  type ReleaseManifest,
  type UpdateResult,
} from '@unsold/support';
import { h } from './dom.ts';
import { resolve } from './tasks.ts';
import type { Studio } from './studio.ts';
import { modal, toast } from './ui/feedback.ts';

export function appIdentity(host: HostBridge): AppIdentity {
  return {
    name: 'Unsold PDF',
    version: __UNSOLD_VERSION__,
    build: __UNSOLD_BUILD__,
    distribution: host.capabilities.distribution,
    repo: 'jans-johnson/unsold-pdf',
    email: 'support@stayunsold.com',
    manifestUrl: 'https://pdf.stayunsold.com/releases/latest.json',
  };
}

const storeName = (host: HostBridge) =>
  host.platform === 'ios' || host.platform === 'macos'
    ? 'the App Store'
    : host.platform === 'android'
      ? 'Google Play'
      : 'the store';

/** What the person is doing right now, without any file names. */
function studioState(studio: Studio): Diagnostic[] {
  const tab = studio.activeTab();
  const doc = studio.activeDoc();
  const toolId =
    doc?.tool?.taskId ?? (tab?.kind === 'tool' ? tab.taskId : null);
  const docs = studio.tabs.filter((t) => t.kind === 'doc').length;
  return [
    [
      'View',
      tab ? (tab.kind === 'doc' ? 'document' : 'tool') : String(studio.active),
    ],
    ['Tool', toolId ? (resolve(toolId)?.task.name ?? toolId) : 'none'],
    ['Open documents', String(docs)],
    [
      'Current document pages',
      String(doc?.viewer?.pdfViewer.pagesCount ?? '-'),
    ],
  ];
}

// ------------------------------------------------------------------ report

export async function openReportDialog(studio: Studio) {
  const app = appIdentity(studio.host);
  const facts = collectDiagnostics(
    app,
    browserEnvironment(studio.host.platform, studioState(studio))
  );
  const text = h('textarea', {
    class: 'report-text',
    rows: 5,
    placeholder:
      'What happened, and what did you expect? Steps to make it happen again help a lot.',
  });
  const body = h(
    'div',
    { class: 'report' },
    h(
      'p',
      { class: 'muted' },
      'Tell us what went wrong. Nothing is sent until you choose how to send it, and your documents are never included.'
    ),
    text,
    h(
      'details',
      { class: 'report-facts' },
      h('summary', {}, 'What else is included'),
      h('pre', {}, formatReport('', facts).split('\n').slice(3).join('\n'))
    ),
    h(
      'p',
      { class: 'muted small' },
      'Reports on GitHub are public. Email reaches us privately. If one particular PDF causes the problem, you can attach it yourself, only if you’re comfortable sharing it.'
    )
  );
  type Action = { send: 'copy' | 'email' | 'github'; words: string };
  const pick = (send: Action['send']) => () => ({ send, words: text.value });
  const choice = await modal<Action>('Report a problem', body, [
    { label: 'Copy report', value: pick('copy') },
    { label: 'Email', value: pick('email') },
    { label: 'Report on GitHub', primary: true, value: pick('github') },
  ]);
  if (!choice) return;
  const title = reportTitle(app, choice.words);
  if (choice.send === 'copy') {
    try {
      await navigator.clipboard.writeText(
        `${title}\n\n${formatReport(choice.words, facts)}`
      );
      toast('Report copied. Paste it into an email or a GitHub issue.');
    } catch {
      toast('Couldn’t copy the report.', { error: true });
    }
  } else if (choice.send === 'email') {
    await studio.host.openExternal(
      mailtoUrl(app, title, formatReport(choice.words, facts))
    );
  } else {
    await studio.host.openExternal(
      githubIssueUrl(
        app,
        title,
        formatReport(choice.words, facts, { markdown: true })
      )
    );
  }
}

// ------------------------------------------------------------------ updates

function getUpdate(studio: Studio, manifest: ReleaseManifest) {
  if (studio.host.capabilities.distribution === 'web') location.reload();
  else void studio.host.openExternal(manifest.url);
}
const getLabel = (studio: Studio) =>
  studio.host.capabilities.distribution === 'web' ? 'Reload' : 'Download';

/** About, version and updates; `check` runs a check straight away. */
export async function openAboutDialog(studio: Studio) {
  const { host } = studio;
  const app = appIdentity(host);
  const store = app.distribution === 'store';
  const status = h('p', { class: 'update-status' });
  const action = h('div', { class: 'update-action' });

  const show = (r: UpdateResult) => {
    action.replaceChildren();
    if (r.status === 'available') {
      status.textContent = `Version ${r.manifest.version} is available.${
        r.manifest.notes ? ` ${r.manifest.notes}` : ''
      }`;
      action.append(
        h(
          'button',
          {
            class: 'btn primary',
            onclick: () => getUpdate(studio, r.manifest),
          },
          `${getLabel(studio)} ${r.manifest.version}`
        )
      );
    } else if (r.status === 'current') {
      status.textContent = 'You have the latest version.';
    } else if (r.status === 'error') {
      status.textContent = 'Couldn’t check for updates. Are you offline?';
    }
  };

  const auto = h('input', { type: 'checkbox' });
  auto.checked = autoCheckEnabled();
  auto.addEventListener('change', () => setAutoCheck(auto.checked));

  const body = h(
    'div',
    { class: 'about' },
    h(
      'p',
      { class: 'about-version' },
      `Version ${app.version} (build ${app.build})`
    ),
    h(
      'p',
      { class: 'muted small' },
      `Installed from: ${distributionLabel(app.distribution)}`
    ),
    store
      ? h('p', {}, `Updates come from ${storeName(host)}.`)
      : h(
          'div',
          {},
          status,
          action,
          h(
            'label',
            { class: 'check-row' },
            auto,
            'Check for new versions automatically (once a day)'
          ),
          h(
            'p',
            { class: 'muted small' },
            'The check downloads one small public file from pdf.stayunsold.com. It sends nothing about you or your files.'
          )
        )
  );
  if (!store) {
    status.textContent = 'Checking for updates…';
    void checkForUpdate(app, { force: true }).then(show);
  }
  const next = await modal<'report' | 'done'>('Unsold PDF', body, [
    { label: 'Report a problem', value: () => 'report' },
    { label: 'Done', primary: true, value: () => 'done' },
  ]);
  if (next === 'report') await openReportDialog(studio);
}

/** The quiet daily check, a little after start-up. */
export function scheduleUpdateCheck(studio: Studio) {
  const app = appIdentity(studio.host);
  if (app.distribution === 'store' || studio.host.selfTest) return;
  setTimeout(async () => {
    const r = await checkForUpdate(app);
    if (r.status !== 'available') return;
    toast(`${app.name} ${r.manifest.version} is available.`, {
      timeout: 0,
      actions: [
        { label: 'Not now', run: () => skipVersion(r.manifest.version) },
        { label: getLabel(studio), run: () => getUpdate(studio, r.manifest) },
      ],
    });
  }, 8000);
}
