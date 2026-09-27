import { categories } from '@unsold/tools/catalog';

export interface Tool {
  id: string;
  name: string;
  icon: string;
  subtitle: string;
  category: string;
  color: string;
}

export interface Category {
  name: string;
  tools: Tool[];
}

export const CATEGORY_STYLE: Record<string, { color: string; icon: string }> = {
  'Edit & Annotate': { color: '#c93f9b', icon: 'ph-pencil-simple-line' },
  'Convert to PDF': { color: '#e36a1f', icon: 'ph-file-plus' },
  'Convert from PDF': { color: '#1f9e74', icon: 'ph-export' },
  'Organize & Manage': { color: '#2f7fe6', icon: 'ph-files' },
  'Optimize & Repair': { color: '#7b5ce6', icon: 'ph-wrench' },
  'Secure PDF': { color: '#c2861a', icon: 'ph-shield-check' },
};
export const POPULAR = 'Popular Tools';

const TOOLS = new Map<string, Tool>();

export const CATEGORIES: Category[] = categories.map((cat) => ({
  name: cat.name,
  tools: cat.tools.map((t) => ({
    id: t.id,
    name: t.name,
    icon: t.icon,
    subtitle: t.subtitle,
    category: cat.name,
    color:
      cat.name === POPULAR
        ? '#e34850'
        : (CATEGORY_STYLE[cat.name]?.color ?? '#555'),
  })),
}));

// A tool listed under Popular and a real category takes the category's colour.
for (const cat of CATEGORIES) {
  if (cat.name === POPULAR) continue;
  for (const t of cat.tools) if (!TOOLS.has(t.id)) TOOLS.set(t.id, t);
}
for (const t of CATEGORIES.find((c) => c.name === POPULAR)?.tools ?? []) {
  if (!TOOLS.has(t.id)) TOOLS.set(t.id, t);
}
TOOLS.set('wasm-settings', {
  id: 'wasm-settings',
  name: 'Engine Settings',
  icon: 'ph-gear',
  subtitle: 'Configure the PyMuPDF, Ghostscript and CPDF engines.',
  category: 'Settings',
  color: '#555',
});

export const tool = (id: string) => TOOLS.get(id);
export const hasTool = (id: string) => TOOLS.has(id);

/** Tools whose result opens as a new document instead of replacing the input. */
export const NEW_DOCUMENT_TOOLS = new Set([
  'merge-pdf',
  'alternate-merge',
  'split-pdf',
  'extract-pages',
  'compare-pdfs',
  'duplex-collate',
  'pdf-to-pdfa',
]);

/** Tools that need more files than the open document, so keep their upload area. */
export const MULTI_INPUT_TOOLS = new Set([
  'merge-pdf',
  'alternate-merge',
  'compare-pdfs',
  'overlay-pdf',
  'bates-numbering',
  'pdf-to-zip',
]);

const NO_PDF_INPUT = new Set([
  'pdf-workflow',
  'markdown-to-pdf',
  'wasm-settings',
]);
export const takesPdf = (id: string) =>
  !NO_PDF_INPUT.has(id) &&
  !!tool(id) &&
  tool(id)?.category !== 'Convert to PDF';

const EXT_ALIASES: Record<string, string> = {
  jpeg: 'jpg',
  tif: 'tiff',
  doc: 'word',
  docx: 'word',
  xls: 'excel',
  xlsx: 'excel',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  eml: 'email',
  msg: 'email',
  md: 'markdown',
  vsdx: 'vsd',
  oxps: 'xps',
  heif: 'heic',
  cbr: 'cbz',
};

/**
 * Tools whose engines need WebAssembly threads (LibreOffice for Office
 * formats, wasm-vips for TIFF). Threads need cross-origin isolation, which
 * Android's WebView can't provide, so there these tools are left out.
 */
const NEEDS_THREADS = new Set([
  'word-to-pdf',
  'excel-to-pdf',
  'powerpoint-to-pdf',
  'odt-to-pdf',
  'ods-to-pdf',
  'odp-to-pdf',
  'odg-to-pdf',
  'rtf-to-pdf',
  'pages-to-pdf',
  'pub-to-pdf',
  'vsd-to-pdf',
  'wpd-to-pdf',
  'wps-to-pdf',
  'pdf-to-tiff',
]);

/** Whether this device can run the tool (see NEEDS_THREADS). */
export const canRun = (id: string) =>
  !NEEDS_THREADS.has(id) || globalThis.crossOriginIsolated === true;

/** The conversion tool for a non-PDF file, if there is one. */
export function converterFor(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const id = `${EXT_ALIASES[ext] ?? ext}-to-pdf`;
  if (TOOLS.has(id)) return id;
  if (/^(gif|avif|ico)$/.test(ext)) return 'image-to-pdf';
  return null;
}
