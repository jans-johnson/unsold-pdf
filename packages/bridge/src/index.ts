import type { HostBridge } from './types.ts';

export type * from './types.ts';
export { createBrowserBridge } from './browser.ts';
export { findToolHost, TOOL_HOST_KEY, type ToolHost } from './tool-host.ts';

/** Picks the host implementation for the environment the UI is running in. */
export async function connectHost(): Promise<HostBridge> {
  if ('__TAURI_INTERNALS__' in window) {
    const { createTauriBridge } = await import('./tauri.ts');
    return createTauriBridge();
  }
  const { createBrowserBridge } = await import('./browser.ts');
  return createBrowserBridge();
}
