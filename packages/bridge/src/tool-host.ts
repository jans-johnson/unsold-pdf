import type { NetRequest, NetResponse } from './types.ts';

/**
 * What the Studio offers to tool pages running inside it (same-origin
 * frames). Tool pages reach it through `window.top.unacrobat`; when a page
 * runs on its own there is no host and it falls back to browser behaviour.
 */
export interface ToolHost {
  /** Hand a result file to the Studio instead of triggering a download. */
  deliverOutput(
    output: { name: string; data: Uint8Array },
    source: Window
  ): void;
  /** Fetch from certificate / timestamp servers through the native host. */
  fetch(request: NetRequest): Promise<NetResponse>;
}

export const TOOL_HOST_KEY = 'unacrobat';

/** The Studio's tool host, if this page is embedded in it. */
export function findToolHost(): ToolHost | null {
  try {
    const top = window.top as (Window & { [TOOL_HOST_KEY]?: ToolHost }) | null;
    return top && top !== window ? (top[TOOL_HOST_KEY] ?? null) : null;
  } catch {
    // Cross-origin parent: not our Studio.
    return null;
  }
}
