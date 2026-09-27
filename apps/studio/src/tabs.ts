import type { PdfDocument } from './pdf.ts';
import type { Viewer } from './viewer.ts';

export interface RunningTool {
  /** Tool page (mode) currently shown. */
  id: string;
  taskId: string;
  layer: HTMLElement;
  /** `null` for modes the Studio renders itself. */
  frame: HTMLIFrameElement | null;
}

export interface DocTab {
  kind: 'doc';
  id: string;
  name: string;
  /** Where the document lives; `null` until it is saved somewhere. */
  handle: string | null;
  bytes: Uint8Array;
  savedBytes: Uint8Array | null;
  dirty: boolean;
  history: Uint8Array[];
  future: Uint8Array[];
  tool: RunningTool | null;
  stageEl: HTMLElement;
  viewerLayer: HTMLElement;
  container: HTMLDivElement;
  pdfDoc?: PdfDocument;
  viewer?: Viewer;
  thumbs?: HTMLElement | null;
  thumbsDoc?: PdfDocument;
  restorePage?: number | null;
  restoreScale?: string | null;
}

export interface ToolTab {
  kind: 'tool';
  id: string;
  taskId: string;
  toolId: string;
  /** The file being converted, when the tab was opened for one. */
  label?: string;
  stageEl: HTMLElement;
  frame: HTMLIFrameElement | null;
}

export type Tab = DocTab | ToolTab;

export const HISTORY_LIMIT = 30;
