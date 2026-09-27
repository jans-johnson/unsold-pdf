import { $, h, icon } from '../dom.ts';

export interface ToastAction {
  label: string;
  run: () => void;
}

export function toast(
  message: string,
  {
    actions = [],
    error = false,
    timeout = 5000,
  }: { actions?: ToastAction[]; error?: boolean; timeout?: number } = {}
) {
  const el = h(
    'div',
    { class: `toast${error ? ' error' : ''}` },
    icon(error ? 'ph-warning-circle' : 'ph-check-circle', 'ph-fill lead'),
    h('span', {}, message),
    h(
      'div',
      { class: 'toast-actions' },
      actions.map((a) =>
        h(
          'button',
          {
            class: 'btn sm',
            onclick: () => {
              a.run();
              el.remove();
            },
          },
          a.label
        )
      ),
      h(
        'button',
        { class: 'icon-btn sm', onclick: () => el.remove() },
        icon('ph-x')
      )
    )
  );
  $('#toasts').append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
}

export interface MenuItem {
  label: string;
  icon: string;
  run: () => void;
}

export function closeMenus() {
  document.querySelectorAll('.menu-pop').forEach((m) => m.remove());
}

export function popMenu(anchor: HTMLElement, items: MenuItem[]) {
  closeMenus();
  const r = anchor.getBoundingClientRect();
  const menu = h(
    'div',
    { class: 'menu-pop' },
    items.map((it) =>
      h(
        'button',
        {
          onclick: () => {
            closeMenus();
            it.run();
          },
        },
        icon(it.icon),
        it.label
      )
    )
  );
  document.body.append(menu);
  const w = menu.offsetWidth;
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  // Close on a click elsewhere, Escape, or a click into a tool page (which
  // blurs this window without reaching its document).
  const close = () => {
    closeMenus();
    document.removeEventListener('pointerdown', off);
    document.removeEventListener('keydown', esc, true);
    window.removeEventListener('blur', close);
  };
  const off = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', esc, true);
    window.addEventListener('blur', close);
  }, 0);
}

interface ModalButton<T> {
  label: string;
  primary?: boolean;
  value: () => T;
}

export function modal<T>(
  title: string,
  body: HTMLElement,
  buttons: ModalButton<T>[]
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const close = (v: T | undefined) => {
      backdrop.remove();
      resolve(v);
    };
    backdrop.append(
      h(
        'div',
        { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        h('h3', {}, title),
        body,
        h(
          'div',
          { class: 'modal-foot' },
          buttons.map((b) =>
            h(
              'button',
              {
                class: `btn ${b.primary ? 'primary' : ''}`,
                onclick: () => close(b.value()),
              },
              b.label
            )
          )
        )
      )
    );
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) close(undefined);
    });
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(undefined);
    });
    $('#modal-root').append(backdrop);
    (
      backdrop.querySelector('input') ??
      backdrop.querySelector<HTMLElement>('.btn.primary')
    )?.focus();
  });
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

export async function confirmUnsaved(name: string): Promise<UnsavedChoice> {
  const body = h(
    'p',
    { class: 'muted', style: 'margin-top:0' },
    'Your changes will be lost if you don’t save them.'
  );
  const choice = await modal<UnsavedChoice>(
    `Save changes to “${name}”?`,
    body,
    [
      { label: 'Cancel', value: () => 'cancel' },
      { label: 'Don’t Save', value: () => 'discard' },
      { label: 'Save', primary: true, value: () => 'save' },
    ]
  );
  return choice ?? 'cancel';
}

export type ApplyChoice = 'apply' | 'discard' | 'cancel';

export async function confirmApply(): Promise<ApplyChoice> {
  const body = h(
    'p',
    { class: 'muted', style: 'margin-top:0' },
    'You have edits in this tool that aren’t in the document yet.'
  );
  const choice = await modal<ApplyChoice>('Apply your changes?', body, [
    { label: 'Cancel', value: () => 'cancel' },
    { label: 'Discard', value: () => 'discard' },
    { label: 'Apply', primary: true, value: () => 'apply' },
  ]);
  return choice ?? 'cancel';
}

export function askPassword(
  name: string,
  retry: boolean
): Promise<string | null | undefined> {
  const input = h('input', {
    type: 'password',
    class: 'search-input',
    style: 'padding-left:12px',
    placeholder: 'Password',
  });
  const body = h(
    'div',
    {},
    h(
      'p',
      { class: 'muted', style: 'margin-top:0' },
      retry
        ? 'Incorrect password. Try again.'
        : `“${name}” is password protected. Enter the password to open it.`
    ),
    input
  );
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')
      body
        .closest('.modal')
        ?.querySelector<HTMLButtonElement>('.btn.primary')
        ?.click();
  });
  return modal<string | null>('Password required', body, [
    { label: 'Cancel', value: () => null },
    { label: 'Open', primary: true, value: () => input.value },
  ]);
}
