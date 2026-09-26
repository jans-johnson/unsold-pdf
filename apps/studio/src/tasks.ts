import { CATEGORIES, hasTool, tool } from './catalog.ts';

/**
 * What people see: a small set of tasks, each grouping the tool pages that do
 * variations of the same job as switchable modes. Tool pages stay the unit of
 * work underneath; every old tool id still resolves to its task and mode.
 */

/** Mode handled by the Studio itself: pick any files and route each one to its converter. */
export const CREATE_FROM_FILES = '@create-from-files';

export interface TaskMode {
  tool: string;
  label: string;
}

export interface Task {
  id: string;
  name: string;
  icon: string;
  summary: string;
  group: string;
  color: string;
  modes: TaskMode[];
  /** Label for the dropdown used when a task has many modes. */
  modePicker?: string;
}

export interface TaskGroup {
  name: string;
  color: string;
  tasks: Task[];
}

type TaskSpec = Omit<Task, 'group' | 'color' | 'modes'> & {
  modes: [string, string][];
};

const SPEC: { name: string; color: string; tasks: TaskSpec[] }[] = [
  {
    name: 'Edit & Sign',
    color: '#c93f9b',
    tasks: [
      {
        id: 'edit',
        name: 'Edit PDF',
        icon: 'ph-pencil-simple-line',
        summary: 'Change text and images, add comments, highlights and stamps.',
        modes: [
          ['edit-pdf-text', 'Text & images'],
          ['edit-pdf', 'Comment & mark up'],
          ['add-stamps', 'Stamps'],
        ],
      },
      {
        id: 'fill-sign',
        name: 'Fill & Sign',
        icon: 'ph-signature',
        summary: 'Fill in forms, add your signature, or build a fillable form.',
        modes: [
          ['form-filler', 'Fill form'],
          ['sign-pdf', 'Sign'],
          ['form-creator', 'Create form'],
        ],
      },
      {
        id: 'page-marks',
        name: 'Page numbers & watermarks',
        icon: 'ph-list-numbers',
        summary:
          'Number pages, add headers, footers, watermarks or Bates numbers.',
        modes: [
          ['page-numbers', 'Page numbers'],
          ['header-footer', 'Header & footer'],
          ['add-watermark', 'Watermark'],
          ['bates-numbering', 'Bates numbers'],
          ['add-page-labels', 'Page labels'],
        ],
      },
      {
        id: 'colors',
        name: 'Colors',
        icon: 'ph-palette',
        summary: 'Adjust colors, go greyscale or dark, change backgrounds.',
        modes: [
          ['adjust-colors', 'Adjust'],
          ['pdf-to-greyscale', 'Greyscale'],
          ['invert-colors', 'Dark mode'],
          ['background-color', 'Background'],
          ['text-color', 'Text color'],
          ['scanner-effect', 'Scanned look'],
        ],
      },
      {
        id: 'document-info',
        name: 'Bookmarks & attachments',
        icon: 'ph-bookmark-simple',
        summary:
          'Bookmarks, a table of contents, attached files, layers and properties.',
        modes: [
          ['bookmark', 'Bookmarks'],
          ['table-of-contents', 'Table of contents'],
          ['edit-attachments', 'Attachments'],
          ['add-attachments', 'Attach files'],
          ['extract-attachments', 'Save attachments'],
          ['pdf-layers', 'Layers'],
          ['edit-metadata', 'Properties'],
        ],
      },
    ],
  },
  {
    name: 'Pages',
    color: '#2f7fe6',
    tasks: [
      {
        id: 'organize',
        name: 'Organize pages',
        icon: 'ph-files',
        summary: 'Reorder, delete, insert or duplicate pages.',
        modes: [
          ['organize-pdf', 'Arrange'],
          ['delete-pages', 'Delete'],
          ['add-blank-page', 'Insert blank'],
          ['remove-blank-pages', 'Remove blank'],
          ['reverse-pages', 'Reverse'],
          ['pdf-multi-tool', 'Page editor'],
        ],
      },
      {
        id: 'rotate-crop',
        name: 'Rotate & crop',
        icon: 'ph-crop',
        summary: 'Turn pages, trim margins, make every page the same size.',
        modes: [
          ['rotate-pdf', 'Rotate'],
          ['rotate-custom', 'Any angle'],
          ['crop-pdf', 'Crop'],
          ['fix-page-size', 'Same page size'],
        ],
      },
      {
        id: 'combine',
        name: 'Combine',
        icon: 'ph-stack',
        summary: 'Merge PDFs, interleave scans, overlay pages.',
        modes: [
          ['merge-pdf', 'Merge'],
          ['alternate-merge', 'Alternate pages'],
          ['duplex-collate', 'Two-sided scans'],
          ['overlay-pdf', 'Overlay'],
          ['combine-single-page', 'One long page'],
          ['pdf-to-zip', 'Bundle as ZIP'],
        ],
      },
      {
        id: 'split',
        name: 'Split',
        icon: 'ph-scissors',
        summary: 'Split into files, pull out pages, cut pages in pieces.',
        modes: [
          ['split-pdf', 'Split'],
          ['extract-pages', 'Extract pages'],
          ['divide-pages', 'Divide pages'],
          ['posterize-pdf', 'Poster tiles'],
        ],
      },
      {
        id: 'print-layout',
        name: 'Print layout',
        icon: 'ph-printer',
        summary: 'Several pages per sheet, or a folded booklet.',
        modes: [
          ['n-up-pdf', 'Pages per sheet'],
          ['pdf-booklet', 'Booklet'],
        ],
      },
    ],
  },
  {
    name: 'Convert',
    color: '#e36a1f',
    tasks: [
      {
        id: 'create',
        name: 'Create PDF',
        icon: 'ph-file-plus',
        summary: 'Turn documents, images, e-books and emails into PDF.',
        modes: [
          [CREATE_FROM_FILES, 'From files'],
          ['image-to-pdf', 'From images'],
          ['markdown-to-pdf', 'Write Markdown'],
        ],
      },
      {
        id: 'export',
        name: 'Export PDF',
        icon: 'ph-export',
        summary: 'Save as Word, Excel, images, text and more.',
        modePicker: 'Format',
        modes: [
          ['pdf-to-word', 'Word'],
          ['pdf-to-excel', 'Excel'],
          ['pdf-to-jpg', 'JPG images'],
          ['pdf-to-png', 'PNG images'],
          ['pdf-to-webp', 'WebP images'],
          ['pdf-to-tiff', 'TIFF'],
          ['pdf-to-bmp', 'BMP images'],
          ['pdf-to-svg', 'SVG'],
          ['pdf-to-text', 'Plain text'],
          ['pdf-to-markdown', 'Markdown'],
          ['extract-tables', 'Tables'],
          ['pdf-to-csv', 'CSV'],
          ['pdf-to-json', 'JSON'],
          ['prepare-pdf-for-ai', 'For AI tools'],
          ['extract-images', 'Embedded images'],
          ['pdf-to-cbz', 'Comic book (CBZ)'],
        ],
      },
    ],
  },
  {
    name: 'Optimize',
    color: '#7b5ce6',
    tasks: [
      {
        id: 'compress',
        name: 'Compress',
        icon: 'ph-arrows-in',
        summary: 'Make the file smaller.',
        modes: [['compress-pdf', 'Compress']],
      },
      {
        id: 'scan-ocr',
        name: 'Scan & OCR',
        icon: 'ph-scan',
        summary: 'Make scans searchable and straighten tilted pages.',
        modes: [
          ['ocr-pdf', 'Recognize text'],
          ['deskew-pdf', 'Straighten'],
        ],
      },
      {
        id: 'repair',
        name: 'Repair & optimize',
        icon: 'ph-wrench',
        summary: 'Fix damaged files, archive as PDF/A, prepare for the web.',
        modes: [
          ['repair-pdf', 'Repair'],
          ['pdf-to-pdfa', 'Archive (PDF/A)'],
          ['linearize-pdf', 'Fast web view'],
          ['rasterize-pdf', 'Flatten to images'],
          ['font-to-outline', 'Fonts to outlines'],
          ['page-dimensions', 'Page sizes'],
        ],
      },
      {
        id: 'compare',
        name: 'Compare',
        icon: 'ph-git-diff',
        summary: 'See what changed between two PDFs.',
        modes: [['compare-pdfs', 'Compare']],
      },
      {
        id: 'automate',
        name: 'Automate',
        icon: 'ph-tree-structure',
        summary: 'Chain several steps into a reusable workflow.',
        modes: [['pdf-workflow', 'Workflow']],
      },
    ],
  },
  {
    name: 'Protect',
    color: '#c2861a',
    tasks: [
      {
        id: 'password',
        name: 'Password & permissions',
        icon: 'ph-lock-key',
        summary: 'Add or remove a password, control printing and copying.',
        modes: [
          ['protect-pdf', 'Add password'],
          ['unlock-pdf', 'Remove password'],
          ['change-permissions', 'Permissions'],
          ['remove-restrictions', 'Remove restrictions'],
        ],
      },
      {
        id: 'clean-up',
        name: 'Clean up',
        icon: 'ph-eraser',
        summary: 'Remove hidden data, comments and scripts; flatten forms.',
        modes: [
          ['sanitize-pdf', 'Remove hidden data'],
          ['remove-metadata', 'Remove metadata'],
          ['remove-annotations', 'Remove comments'],
          ['flatten-pdf', 'Flatten'],
        ],
      },
      {
        id: 'certify',
        name: 'Digital signatures',
        icon: 'ph-certificate',
        summary: 'Sign with a certificate, verify signatures, add a timestamp.',
        modes: [
          ['digital-sign-pdf', 'Sign with certificate'],
          ['validate-signature-pdf', 'Verify'],
          ['timestamp-pdf', 'Timestamp'],
        ],
      },
    ],
  },
];

const isAvailable = (id: string) => id === CREATE_FROM_FILES || hasTool(id);

export const GROUPS: TaskGroup[] = SPEC.map((g) => ({
  name: g.name,
  color: g.color,
  tasks: g.tasks
    .map((t) => ({
      ...t,
      group: g.name,
      color: g.color,
      modes: t.modes
        .filter(([id]) => isAvailable(id))
        .map(([toolId, label]) => ({ tool: toolId, label })),
    }))
    .filter((t) => t.modes.length > 0),
}));

const TASKS = new Map(
  GROUPS.flatMap((g) => g.tasks.map((t) => [t.id, t] as const))
);
const TASK_OF_TOOL = new Map<string, Task>();
for (const t of TASKS.values())
  for (const m of t.modes)
    if (!TASK_OF_TOOL.has(m.tool)) TASK_OF_TOOL.set(m.tool, t);

export const task = (id: string) => TASKS.get(id);

export interface Resolved {
  task: Task;
  tool: string;
}

/**
 * Accepts a task id or any tool id. Converters that aren't listed as modes
 * belong to Create PDF; anything else (e.g. settings) becomes its own task.
 */
export function resolve(id: string): Resolved | null {
  const direct = TASKS.get(id);
  if (direct) return { task: direct, tool: direct.modes[0].tool };
  const owner = TASK_OF_TOOL.get(id);
  if (owner) return { task: owner, tool: id };
  const t = tool(id);
  if (!t) return null;
  if (t.category === 'Convert to PDF')
    return { task: TASKS.get('create')!, tool: id };
  return {
    task: {
      id,
      name: t.name,
      icon: t.icon,
      summary: t.subtitle,
      group: t.category,
      color: t.color,
      modes: [{ tool: id, label: t.name }],
    },
    tool: id,
  };
}

/** Label for a mode, including converters shown under Create PDF. */
export function modeLabel(resolved: Resolved): string {
  return (
    resolved.task.modes.find((m) => m.tool === resolved.tool)?.label ??
    tool(resolved.tool)?.name ??
    resolved.tool
  );
}

/** Search text for a task: its own words plus every underlying tool's name and description. */
export function searchText(t: Task): string {
  const tools =
    t.id === 'create'
      ? (CATEGORIES.find((c) => c.name === 'Convert to PDF')?.tools ?? [])
      : [];
  return [
    t.name,
    t.summary,
    ...t.modes.flatMap((m) => [
      m.label,
      tool(m.tool)?.name ?? '',
      tool(m.tool)?.subtitle ?? '',
    ]),
    ...tools.flatMap((x) => [x.name, x.subtitle]),
  ]
    .join(' ')
    .toLowerCase();
}

/** File types Create PDF accepts, for the drop zone's hint. */
export function convertibleFormats(): string[] {
  const names = (
    CATEGORIES.find((c) => c.name === 'Convert to PDF')?.tools ?? []
  )
    .map((t) => t.name.replace(/ to PDF$/, ''))
    .filter((n) => n !== 'Images');
  return [...new Set(names)];
}

export type Shortcut = [target: string, label: string, icon: string];

export const RECOMMENDED: Shortcut[] = [
  ['edit', 'Edit a PDF', 'ph-pencil-simple-line'],
  ['fill-sign', 'Fill & Sign', 'ph-signature'],
  ['create', 'Create a PDF', 'ph-file-plus'],
  ['export', 'Export a PDF', 'ph-export'],
  ['combine', 'Combine files', 'ph-stack'],
  ['organize', 'Organize pages', 'ph-files'],
  ['compress', 'Compress', 'ph-arrows-in'],
  ['password', 'Protect', 'ph-lock-key'],
];

export const QUICK_RAIL: (Shortcut | null)[] = [
  ['edit-pdf-text', 'Edit text & images', 'ph-cursor-text'],
  ['edit-pdf', 'Comment & mark up', 'ph-chat-circle-text'],
  ['fill-sign', 'Fill & Sign', 'ph-signature'],
  null,
  ['organize', 'Organize pages', 'ph-files'],
  ['page-marks', 'Page numbers & watermarks', 'ph-list-numbers'],
  ['compress', 'Compress', 'ph-arrows-in'],
  ['scan-ocr', 'Scan & OCR', 'ph-scan'],
  ['password', 'Protect', 'ph-lock-key'],
  ['export', 'Export', 'ph-export'],
];
