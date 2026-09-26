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
  /** The page's own "back"/"done" control: close it and return to the document. */
  requestClose(source: Window): void;
}

/**
 * What a tool page can tell the Studio about work in progress, so closing
 * the tool or switching modes never throws edits away silently.
 */
export interface ToolPageState {
  hasChanges(): boolean;
  /** Apply the changes; the page then delivers its output as usual. */
  apply(): void | Promise<void>;
}

export const TOOL_PAGE_KEY = 'unacrobatTool';

export function registerToolPage(state: ToolPageState) {
  (window as Window & { [TOOL_PAGE_KEY]?: ToolPageState })[TOOL_PAGE_KEY] =
    state;
}

/** The state a tool page registered, read by the Studio from its frame. */
export function toolPageState(
  win: Window | null | undefined
): ToolPageState | null {
  try {
    return (
      (win as (Window & { [TOOL_PAGE_KEY]?: ToolPageState }) | null)?.[
        TOOL_PAGE_KEY
      ] ?? null
    );
  } catch {
    return null;
  }
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
