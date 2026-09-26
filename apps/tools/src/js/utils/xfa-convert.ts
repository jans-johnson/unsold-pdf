// Turns XFA forms into standard AcroForm PDFs that open in any viewer.
//
// Hybrid XFA files already carry a full set of AcroForm fields, so dropping
// the /XFA entry is enough. Pure XFA files have no real page content: pdf.js
// lays them out as HTML, so we paint that layout onto a canvas (inside the
// viewer iframe, where the form's embedded fonts are loaded) and rebuild the
// inputs as AcroForm fields on top of the page image.
import {
  type Color,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFName,
  PDFPage,
  PDFRadioGroup,
  StandardFonts,
  TextAlignment,
  TextRenderingMode,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setTextRenderingMode,
} from 'pdf-lib';
import { loadPdfDocument } from './load-pdf-document.js';

// Minimal shapes of the pdf.js viewer objects we touch across the iframe.
interface XfaPdfPage {
  getViewport(params: { scale: number }): { width: number; height: number };
  getXfa(): Promise<unknown>;
}

export interface XfaPdfDocument {
  numPages: number;
  isPureXfa: boolean;
  annotationStorage: { size: number };
  getPage(pageNumber: number): Promise<XfaPdfPage>;
  getMetadata(): Promise<{ info: Record<string, unknown> }>;
  saveDocument(): Promise<Uint8Array>;
  getData(): Promise<Uint8Array>;
}

export interface XfaViewerWindow extends Window {
  PDFViewerApplication?: {
    pdfDocument: XfaPdfDocument | null;
    pdfLinkService: unknown;
    pdfScriptingManager?: {
      dispatchWillSave(): Promise<void>;
      dispatchDidSave(): Promise<void>;
    };
    downloadOrSave(): Promise<void>;
  };
  pdfjsLib?: {
    XfaLayer: {
      render(params: {
        xfaHtml: unknown;
        div: HTMLElement;
        annotationStorage: unknown;
        linkService: unknown;
        intent: string;
      }): unknown;
    };
  };
}

export type XfaKind = 'none' | 'hybrid' | 'pure';

export async function detectXfa(doc: XfaPdfDocument): Promise<XfaKind> {
  if (doc.isPureXfa) return 'pure';
  const { info } = await doc.getMetadata();
  return info.IsXFAPresent ? 'hybrid' : 'none';
}

/**
 * Drops the XFA layer from a hybrid form so every viewer falls back to its
 * AcroForm fields. Also removes the Reader usage-rights signature, which the
 * edit has invalidated and which makes Adobe Reader complain.
 */
export async function removeXfa(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await loadPdfDocument(bytes);
  const { catalog } = doc;
  const acroForm = catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  acroForm?.delete(PDFName.of('XFA'));
  catalog.delete(PDFName.of('NeedsRendering'));
  catalog.delete(PDFName.of('Perms'));
  return doc.save();
}

// ---------------------------------------------------------------------------
// Pure XFA: snapshot the pdf.js HTML layout
// ---------------------------------------------------------------------------

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type XfaField =
  | {
      kind: 'text';
      name: string;
      box: Box;
      value: string;
      multiline: boolean;
      fontSize: number;
      align: TextAlignment;
      maxLength?: number;
      readOnly: boolean;
      required: boolean;
    }
  | {
      kind: 'checkbox';
      name: string;
      box: Box;
      checked: boolean;
      readOnly: boolean;
    }
  | {
      kind: 'radio';
      group: string;
      option: string;
      box: Box;
      checked: boolean;
      readOnly: boolean;
    }
  | {
      kind: 'choice';
      name: string;
      box: Box;
      options: string[];
      selected: string[];
      multiple: boolean;
      fontSize: number;
      readOnly: boolean;
    };

interface TextRun {
  text: string;
  x: number;
  baseline: number;
  fontSize: number;
}

export interface XfaPageSnapshot {
  width: number;
  height: number;
  png: Uint8Array;
  fields: XfaField[];
  text: TextRun[];
}

// 2.5x CSS px per PDF point = 180 dpi: prints cleanly without bloating
// multi-page forms.
const RENDER_SCALE = 2.5;
const MAX_CANVAS_SIDE = 8192;

function isTransparent(color: string): boolean {
  return (
    color === 'transparent' ||
    /rgba\([^)]*,\s*0\)$/.test(color) ||
    /\/\s*0\)$/.test(color)
  );
}

function fieldLabel(el: Element): string {
  const label = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ');
  return label.trim().slice(0, 80);
}

function textAlignment(cs: CSSStyleDeclaration): TextAlignment {
  if (cs.textAlign === 'center') return TextAlignment.Center;
  if (cs.textAlign === 'right' || cs.textAlign === 'end') {
    return TextAlignment.Right;
  }
  return TextAlignment.Left;
}

class XfaPagePainter {
  readonly fields: XfaField[] = [];
  readonly text: TextRun[] = [];
  private readonly win: Window;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly originX: number;
  private readonly originY: number;
  private groupNames = new Map<string, string>();

  constructor(win: Window, ctx: CanvasRenderingContext2D, origin: DOMRect) {
    this.win = win;
    this.ctx = ctx;
    this.originX = origin.left;
    this.originY = origin.top;
  }

  private boxOf(el: Element): Box {
    const r = el.getBoundingClientRect();
    return {
      x: r.left - this.originX,
      y: r.top - this.originY,
      width: r.width,
      height: r.height,
    };
  }

  async paint(el: Element): Promise<void> {
    const cs = this.win.getComputedStyle(el);
    if (cs.display === 'none') return;
    const visible = cs.visibility === 'visible';
    const tag = el.tagName.toLowerCase();
    const box = this.boxOf(el);
    const isToggle =
      tag === 'input' &&
      ['checkbox', 'radio'].includes((el as HTMLInputElement).type);

    if (visible && !isToggle) this.paintBox(cs, box);

    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      // Hidden XFA fields hold script state; they'd only clutter the page.
      if (visible) this.collectField(el as HTMLElement, cs, box);
      return;
    }
    if (tag === 'img') {
      if (visible) await this.paintImage(el as HTMLImageElement, box);
      return;
    }
    if (tag === 'svg') {
      if (visible) await this.paintSvg(el as SVGSVGElement, box);
      return;
    }

    const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
    if (clips) {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.rect(box.x, box.y, box.width, box.height);
      this.ctx.clip();
    }
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (visible) this.paintText(child as Text, cs);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        await this.paint(child as Element);
      }
    }
    if (clips) this.ctx.restore();
  }

  private paintBox(cs: CSSStyleDeclaration, box: Box): void {
    const { ctx } = this;
    if (!isTransparent(cs.backgroundColor)) {
      ctx.fillStyle = cs.backgroundColor;
      ctx.fillRect(box.x, box.y, box.width, box.height);
    }
    const sides = [
      ['Top', box.x, box.y, box.x + box.width, box.y],
      [
        'Right',
        box.x + box.width,
        box.y,
        box.x + box.width,
        box.y + box.height,
      ],
      [
        'Bottom',
        box.x,
        box.y + box.height,
        box.x + box.width,
        box.y + box.height,
      ],
      ['Left', box.x, box.y, box.x, box.y + box.height],
    ] as const;
    for (const [side, x1, y1, x2, y2] of sides) {
      const width = parseFloat(
        cs.getPropertyValue(`border-${side.toLowerCase()}-width`)
      );
      const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`);
      const color = cs.getPropertyValue(`border-${side.toLowerCase()}-color`);
      if (!(width > 0) || style === 'none' || style === 'hidden') continue;
      if (isTransparent(color)) continue;
      // Stroke along the middle of the border band, inside the box.
      const inset = width / 2;
      const dx = side === 'Left' ? inset : side === 'Right' ? -inset : 0;
      const dy = side === 'Top' ? inset : side === 'Bottom' ? -inset : 0;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (style === 'dashed') ctx.setLineDash([width * 3, width * 3]);
      if (style === 'dotted') ctx.setLineDash([width, width]);
      ctx.beginPath();
      ctx.moveTo(x1 + dx, y1 + dy);
      ctx.lineTo(x2 + dx, y2 + dy);
      ctx.stroke();
      ctx.restore();
    }
  }

  private paintText(node: Text, cs: CSSStyleDeclaration): void {
    const data = node.data;
    if (!data.trim()) return;
    const { ctx } = this;
    const fontSize = parseFloat(cs.fontSize) || 10;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.fillStyle = cs.color;
    ctx.textBaseline = 'alphabetic';
    if ('fontKerning' in ctx) ctx.fontKerning = 'none';
    const metrics = ctx.measureText('Hg');
    const ascent = metrics.fontBoundingBoxAscent ?? fontSize * 0.8;
    const descent = metrics.fontBoundingBoxDescent ?? fontSize * 0.2;

    // Walk the characters to recover the browser's line breaks and skip
    // whitespace it collapsed.
    const lines: {
      text: string;
      left: number;
      top: number;
      right: number;
      height: number;
    }[] = [];
    const range = node.ownerDocument.createRange();
    for (let i = 0; i < data.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getClientRects()[0];
      if (!rect) continue;
      const ch = data[i]!;
      if (rect.width === 0 && /\s/.test(ch)) continue;
      const cur = lines.at(-1);
      if (
        cur &&
        Math.abs(rect.top - cur.top) < 1 &&
        rect.left >= cur.right - 1
      ) {
        cur.text += /\s/.test(ch) ? ' ' : ch;
        cur.right = rect.right;
      } else {
        if (/\s/.test(ch)) continue;
        lines.push({
          text: ch,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          height: rect.height,
        });
      }
    }

    const underline = cs.textDecorationLine.includes('underline');
    for (const line of lines) {
      const text = line.text.trimEnd();
      if (!text) continue;
      const x = line.left - this.originX;
      const baseline =
        line.top -
        this.originY +
        (line.height - (ascent + descent)) / 2 +
        ascent;
      ctx.fillText(text, x, baseline);
      if (underline) {
        ctx.fillRect(
          x,
          baseline + 1,
          line.right - line.left,
          Math.max(0.5, fontSize / 15)
        );
      }
      this.text.push({ text, x, baseline, fontSize });
    }
  }

  private async paintImage(img: HTMLImageElement, box: Box): Promise<void> {
    try {
      await img.decode();
      this.ctx.drawImage(img, box.x, box.y, box.width, box.height);
    } catch {
      // A broken image shouldn't sink the whole page.
    }
  }

  private async paintSvg(svg: SVGSVGElement, box: Box): Promise<void> {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(box.width));
    clone.setAttribute('height', String(box.height));
    // Inline computed stroke/fill so the standalone image matches.
    const src = [svg, ...Array.from(svg.querySelectorAll('*'))];
    const dst = [clone, ...Array.from(clone.querySelectorAll('*'))];
    src.forEach((el, i) => {
      const cs = this.win.getComputedStyle(el);
      const target = dst[i] as SVGElement;
      for (const prop of [
        'stroke',
        'stroke-width',
        'stroke-dasharray',
        'fill',
      ]) {
        target.style.setProperty(prop, cs.getPropertyValue(prop));
      }
    });
    const markup = new XMLSerializer().serializeToString(clone);
    const img = this.win.document.createElement('img');
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    await this.paintImage(img, box);
  }

  private collectField(
    el: HTMLElement,
    cs: CSSStyleDeclaration,
    box: Box
  ): void {
    if (box.width < 1 || box.height < 1) return;
    const tag = el.tagName.toLowerCase();
    const fallbackName = `Field ${this.fields.length + 1}`;

    if (tag === 'select') {
      const select = el as HTMLSelectElement;
      const visibleOptions = Array.from(select.options).filter(
        (o) => !o.hidden
      );
      const optionText = (o: HTMLOptionElement) => o.text.trim() || o.value;
      this.fields.push({
        kind: 'choice',
        name: fieldLabel(el) || fallbackName,
        box,
        options: [...new Set(visibleOptions.map(optionText))],
        selected: visibleOptions.filter((o) => o.selected).map(optionText),
        multiple: select.multiple,
        fontSize: parseFloat(cs.fontSize) || 10,
        readOnly: select.disabled,
      });
      return;
    }

    const input = el as HTMLInputElement | HTMLTextAreaElement;
    const readOnly = input.readOnly || input.disabled;
    const type = tag === 'input' ? (input as HTMLInputElement).type : '';

    if (type === 'checkbox') {
      this.fields.push({
        kind: 'checkbox',
        name: fieldLabel(el) || fallbackName,
        box,
        checked: (input as HTMLInputElement).checked,
        readOnly,
      });
      return;
    }
    if (type === 'radio') {
      const groupKey = input.name.replace(/-print$/, '');
      if (!this.groupNames.has(groupKey)) {
        this.groupNames.set(groupKey, `Choice ${this.groupNames.size + 1}`);
      }
      this.fields.push({
        kind: 'radio',
        group: this.groupNames.get(groupKey)!,
        option: fieldLabel(el) || input.getAttribute('xfaOn') || 'On',
        box,
        checked: (input as HTMLInputElement).checked,
        readOnly,
      });
      return;
    }

    this.fields.push({
      kind: 'text',
      name: fieldLabel(el) || fallbackName,
      box,
      value: input.value,
      multiline: tag === 'textarea',
      fontSize: parseFloat(cs.fontSize) || 10,
      align: textAlignment(cs),
      maxLength: input.maxLength > 0 ? input.maxLength : undefined,
      readOnly,
      required: input.required,
    });
  }
}

/**
 * Renders every page of a pure XFA document inside the pdf.js viewer iframe
 * and captures its look plus the positions and values of its inputs.
 */
export async function snapshotXfaPages(
  win: XfaViewerWindow,
  onProgress?: (page: number, total: number) => void
): Promise<XfaPageSnapshot[]> {
  const app = win.PDFViewerApplication;
  const doc = app?.pdfDocument;
  const XfaLayer = win.pdfjsLib?.XfaLayer;
  if (!app || !doc || !XfaLayer) throw new Error('PDF viewer is not ready');

  const d = win.document;
  await d.fonts.ready;
  const host = d.createElement('div');
  host.style.cssText =
    'position:fixed;left:-100000px;top:0;pointer-events:none;contain:layout;';
  d.body.append(host);

  const pages: XfaPageSnapshot[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress?.(n, doc.numPages);
      const page = await doc.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      const xfaHtml = await page.getXfa();

      const pageDiv = d.createElement('div');
      pageDiv.style.cssText = `position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#fff;`;
      const layer = d.createElement('div');
      pageDiv.append(layer);
      host.replaceChildren(pageDiv);
      XfaLayer.render({
        xfaHtml,
        div: layer,
        annotationStorage: doc.annotationStorage,
        linkService: app.pdfLinkService,
        intent: 'print',
      });
      await d.fonts.ready;

      const scale = Math.min(
        RENDER_SCALE,
        MAX_CANVAS_SIDE / Math.max(width, height)
      );
      const canvas = d.createElement('canvas');
      canvas.width = Math.ceil(width * scale);
      canvas.height = Math.ceil(height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is not available');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);

      const painter = new XfaPagePainter(
        win,
        ctx,
        pageDiv.getBoundingClientRect()
      );
      await painter.paint(layer);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      if (!blob) throw new Error(`Could not render page ${n}`);
      pages.push({
        width,
        height,
        png: new Uint8Array(await blob.arrayBuffer()),
        fields: painter.fields,
        text: painter.text,
      });
    }
  } finally {
    host.remove();
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Pure XFA: rebuild as an AcroForm PDF
// ---------------------------------------------------------------------------

function uniqueName(taken: Set<string>, wanted: string): string {
  // Periods would make pdf-lib build a field hierarchy.
  const base = wanted.replace(/\./g, '_') || 'Field';
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base} (${i})`;
  taken.add(name);
  return name;
}

function drawInvisibleText(
  page: PDFPage,
  runs: TextRun[],
  font: PDFFont,
  charset: Set<number>
): void {
  // Selectable/searchable text over the page image, like an OCR layer.
  page.pushOperators(
    pushGraphicsState(),
    setTextRenderingMode(TextRenderingMode.Invisible)
  );
  for (const run of runs) {
    const text = Array.from(run.text)
      .map((ch) => (charset.has(ch.codePointAt(0)!) ? ch : '?'))
      .join('');
    page.drawText(text, {
      x: run.x,
      y: page.getHeight() - run.baseline,
      size: run.fontSize,
      font,
    });
  }
  page.pushOperators(popGraphicsState());
}

export async function buildAcroFormPdf(
  pages: XfaPageSnapshot[],
  title?: string
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const charset = new Set(font.getCharacterSet());
  const form = doc.getForm();
  const names = new Set<string>();
  const radioGroups = new Map<
    string,
    { group: PDFRadioGroup; options: Set<string> }
  >();
  const noChrome: {
    backgroundColor?: Color;
    borderColor?: Color;
    borderWidth: number;
  } = {
    backgroundColor: undefined,
    borderColor: undefined,
    borderWidth: 0,
  };
  const boxChrome = {
    backgroundColor: rgb(1, 1, 1),
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  };

  for (const snap of pages) {
    const page = doc.addPage([snap.width, snap.height]);
    const image = await doc.embedPng(snap.png);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: snap.width,
      height: snap.height,
    });
    drawInvisibleText(page, snap.text, font, charset);

    for (const field of snap.fields) {
      const rect = {
        x: field.box.x,
        y: snap.height - field.box.y - field.box.height,
        width: field.box.width,
        height: field.box.height,
      };
      // Values are set after addToPage: addToPage draws an appearance straight
      // away, and a value Helvetica can't encode would abort it.
      switch (field.kind) {
        case 'text': {
          const tf = form.createTextField(uniqueName(names, field.name));
          if (field.multiline) tf.enableMultiline();
          tf.setAlignment(field.align);
          tf.addToPage(page, {
            ...rect,
            ...noChrome,
            font,
            textColor: rgb(0, 0, 0),
          });
          tf.setFontSize(field.fontSize);
          if (field.maxLength && field.value.length <= field.maxLength) {
            tf.setMaxLength(field.maxLength);
          }
          if (field.value) tf.setText(field.value);
          if (field.required) tf.enableRequired();
          if (field.readOnly) tf.enableReadOnly();
          break;
        }
        case 'checkbox': {
          const cb = form.createCheckBox(uniqueName(names, field.name));
          cb.addToPage(page, { ...rect, ...boxChrome });
          if (field.checked) cb.check();
          if (field.readOnly) cb.enableReadOnly();
          break;
        }
        case 'radio': {
          let entry = radioGroups.get(field.group);
          if (!entry) {
            entry = {
              group: form.createRadioGroup(uniqueName(names, field.group)),
              options: new Set(),
            };
            radioGroups.set(field.group, entry);
          }
          const option = uniqueName(entry.options, field.option);
          entry.group.addOptionToPage(option, page, { ...rect, ...boxChrome });
          if (field.checked) entry.group.select(option);
          if (field.readOnly) entry.group.enableReadOnly();
          break;
        }
        case 'choice': {
          const name = uniqueName(names, field.name);
          const list = field.multiple
            ? form.createOptionList(name)
            : form.createDropdown(name);
          list.addToPage(page, {
            ...rect,
            ...noChrome,
            font,
            textColor: rgb(0, 0, 0),
          });
          list.setFontSize(field.fontSize);
          list.addOptions(field.options);
          const selected = field.selected.filter((s) =>
            field.options.includes(s)
          );
          if (field.multiple && selected.length) {
            form.getOptionList(name).enableMultiselect();
            list.select(selected);
          } else if (selected[0]) {
            list.select(selected[0]);
          }
          if (field.readOnly) list.enableReadOnly();
          break;
        }
      }
    }
  }

  // Draw each field's appearance ourselves so one value Helvetica can't
  // encode doesn't fail the save; viewers regenerate those via NeedAppearances.
  let needAppearances = false;
  for (const field of form.getFields()) {
    try {
      (
        field as unknown as { defaultUpdateAppearances(f: PDFFont): void }
      ).defaultUpdateAppearances(font);
    } catch {
      needAppearances = true;
    }
  }
  if (needAppearances) {
    form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  }

  if (title) doc.setTitle(title);
  doc.setProducer('Unsold PDF');
  doc.setCreator('Unsold PDF Form Filler (converted from XFA)');
  return doc.save({ updateFieldAppearances: false });
}
