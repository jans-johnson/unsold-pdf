import type { PdfDocument } from './pdf.ts';
import type { Viewer } from './viewer.ts';

export interface RunningTool {
  id: string;
  layer: HTMLElement;
  frame: HTMLIFrameElement;
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
  toolId: string;
  stageEl: HTMLElement;
  frame: HTMLIFrameElement;
}

export type Tab = DocTab | ToolTab;

export const HISTORY_LIMIT = 30;
