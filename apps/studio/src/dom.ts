type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> & {
  class?: string;
  style?: string;
  dataset?: Record<string, string | number>;
};

/** Minimal element factory: `h('button', { onclick }, icon('ph-x'), 'Close')`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'style') el.style.cssText = String(value);
    else if (key === 'dataset') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>))
        el.dataset[k] = String(v);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value as EventListener);
    } else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(el: Element, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export const icon = (name: string, cls = 'ph') =>
  h('i', { class: `${cls} ${name}` });

export function $<T extends HTMLElement = HTMLElement>(
  selector: string,
  root: ParentNode = document
): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

export function formatBytes(n: number | undefined): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function timeAgo(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} days ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const isPdfBytes = (u8: Uint8Array) =>
  u8.length > 4 &&
  u8[0] === 0x25 &&
  u8[1] === 0x50 &&
  u8[2] === 0x44 &&
  u8[3] === 0x46;

/** Folder part of a desktop path handle, shortened to ~ for home; '' for mobile URIs. */
export function locationOf(handle: string | null): string {
  if (!handle || /^[a-z][a-z0-9+.-]+:\/\//i.test(handle)) return '';
  const cut = Math.max(handle.lastIndexOf('/'), handle.lastIndexOf('\\'));
  return handle.slice(0, cut).replace(/^\/(Users|home)\/[^/]+/, '~');
}

let uid = 0;
export const nextId = () => `t${++uid}`;

export function storage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: preferences just don't persist */
  }
}
