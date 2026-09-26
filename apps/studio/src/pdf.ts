import type * as PdfjsLib from 'pdfjs-dist';
import type * as PdfjsViewer from 'pdfjs-dist/web/pdf_viewer.mjs';

// PDF.js ships with the tool pages (same origin); the Studio reuses that copy
// instead of bundling a second one. Types come from pdfjs-dist.
const BASE = '/pdfjs-viewer/';

document.head.append(
  Object.assign(document.createElement('link'), {
    rel: 'stylesheet',
    href: `${BASE}pdf_viewer.css`,
  })
);

await import(/* @vite-ignore */ `${BASE}pdf.mjs`);
export const pdfjs = (globalThis as unknown as { pdfjsLib: typeof PdfjsLib })
  .pdfjsLib;
export const viewerLib = (await import(
  /* @vite-ignore */ `${BASE}pdf_viewer.mjs`
)) as typeof PdfjsViewer;

pdfjs.GlobalWorkerOptions.workerSrc = `${BASE}pdf.worker.mjs`;

export const DOCUMENT_OPTIONS = {
  cMapUrl: `${BASE}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${BASE}standard_fonts/`,
  wasmUrl: `${BASE}wasm/`,
  iccUrl: `${BASE}iccs/`,
};

export type PdfDocument = PdfjsLib.PDFDocumentProxy;
