/**
 * A small, dismissible suggestion on Home when Unsold PDF isn't the app that
 * opens PDFs. Shown on every platform that can tell (not iOS or the web),
 * until it's set or the person says no.
 */
import { $, h, icon } from './dom.ts';
import type { Studio } from './studio.ts';
import { toast } from './ui/feedback.ts';

const DISMISSED = 'unsold.defaultApp.dismissed';

const dismissed = () => {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
};
const dismiss = () => {
  try {
    localStorage.setItem(DISMISSED, '1');
  } catch {
    /* shows again next launch */
  }
};

export async function mountDefaultAppCard(studio: Studio) {
  const card = $('#default-card');
  const { host } = studio;
  const refresh = async () => {
    if (dismissed()) return void (card.hidden = true);
    card.hidden =
      (await host.defaultPdfStatus().catch(() => 'unknown')) !== 'no';
  };
  const show = (title: string, detail: string, actions: HTMLElement[]) =>
    card.replaceChildren(
      icon('ph-file-pdf', 'ph-fill'),
      h(
        'div',
        { class: 'text' },
        h('strong', {}, title),
        h('span', {}, detail)
      ),
      h('div', { class: 'actions' }, ...actions)
    );
  const close = h(
    'button',
    {
      class: 'icon-btn sm',
      title: 'Not now',
      onclick: () => {
        dismiss();
        card.hidden = true;
      },
    },
    icon('ph-x')
  );
  const set = h(
    'button',
    {
      class: 'btn primary sm',
      onclick: async () => {
        const r = await host.makeDefaultPdfApp();
        if (r.outcome === 'done') {
          card.hidden = true;
          toast('Unsold PDF now opens your PDFs.');
        } else if (r.message) {
          show('Almost there', r.message, [close]);
        } else {
          card.hidden = true;
        }
      },
    },
    'Set as default'
  );
  show('Open PDFs with Unsold PDF?', 'Make it the app your PDFs open in.', [
    set,
    close,
  ]);
  await refresh();
  // Coming back from Settings: check again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });
}
