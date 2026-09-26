import { describe, expect, it, vi } from 'vitest';
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
  TextAlignment,
  decodePDFRawStream,
} from 'pdf-lib';

// qpdf-wasm isn't available under jsdom; the decrypt pass is irrelevant here.
vi.mock('../js/utils/load-pdf-document.js', () => ({
  loadPdfDocument: (bytes: Uint8Array) => PDFDocument.load(bytes),
}));

import {
  buildAcroFormPdf,
  removeXfa,
  type XfaPageSnapshot,
} from '../js/utils/xfa-convert';

// 1x1 white PNG.
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'
  ),
  (c) => c.charCodeAt(0)
);

async function makeHybridPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const field = doc.getForm().createTextField('name');
  field.addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
  field.setText('Ada');
  const acroForm = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
  acroForm.set(
    PDFName.of('XFA'),
    doc.context.obj([PDFString.of('datasets'), PDFString.of('<xdp/>')])
  );
  doc.catalog.set(PDFName.of('NeedsRendering'), PDFBool.False);
  doc.catalog.set(PDFName.of('Perms'), doc.context.obj({}));
  return doc.save();
}

describe('removeXfa', () => {
  it('drops the XFA layer and usage rights but keeps AcroForm fields', async () => {
    const out = await PDFDocument.load(await removeXfa(await makeHybridPdf()));
    const acroForm = out.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    expect(acroForm.has(PDFName.of('XFA'))).toBe(false);
    expect(acroForm.lookup(PDFName.of('Fields'), PDFArray).size()).toBe(1);
    expect(out.catalog.has(PDFName.of('NeedsRendering'))).toBe(false);
    expect(out.catalog.has(PDFName.of('Perms'))).toBe(false);
    expect(out.getForm().getTextField('name').getText()).toBe('Ada');
  });
});

describe('buildAcroFormPdf', () => {
  const box = { x: 10, y: 20, width: 100, height: 18 };
  const page: XfaPageSnapshot = {
    width: 300,
    height: 400,
    png: PNG,
    text: [{ text: 'Applicant name', x: 10, baseline: 15, fontSize: 9 }],
    fields: [
      {
        kind: 'text',
        name: 'Family.name',
        box,
        value: 'Lovelace',
        multiline: false,
        fontSize: 10,
        align: TextAlignment.Left,
        maxLength: 20,
        readOnly: false,
        required: true,
      },
      {
        kind: 'text',
        name: 'Family.name',
        box: { ...box, y: 50 },
        value: '日本',
        multiline: true,
        fontSize: 10,
        align: TextAlignment.Right,
        readOnly: true,
        required: false,
      },
      {
        kind: 'checkbox',
        name: 'Agree',
        box: { ...box, y: 80, width: 10 },
        checked: true,
        readOnly: false,
      },
      {
        kind: 'radio',
        group: 'Choice 1',
        option: 'Yes',
        box: { ...box, y: 100, width: 10 },
        checked: false,
        readOnly: false,
      },
      {
        kind: 'radio',
        group: 'Choice 1',
        option: 'No',
        box: { ...box, y: 120, width: 10 },
        checked: true,
        readOnly: false,
      },
      {
        kind: 'choice',
        name: 'Country',
        box: { ...box, y: 140 },
        options: ['Australia', 'Canada'],
        selected: ['Canada'],
        multiple: false,
        fontSize: 9,
        readOnly: false,
      },
    ],
  };

  it('rebuilds inputs as AcroForm fields at the same place', async () => {
    const out = await PDFDocument.load(
      await buildAcroFormPdf([page], 'My form')
    );
    const form = out.getForm();

    expect(out.getTitle()).toBe('My form');
    const first = form.getTextField('Family_name');
    expect(first.getText()).toBe('Lovelace');
    expect(first.getMaxLength()).toBe(20);
    expect(first.isRequired()).toBe(true);
    const rect = first.acroField.getWidgets()[0]!.getRectangle();
    // y flips from top-left CSS space to bottom-left PDF space.
    expect(rect).toEqual({ x: 10, y: 400 - 20 - 18, width: 100, height: 18 });

    const second = form.getTextField('Family_name (2)');
    expect(second.getText()).toBe('日本');
    expect(second.isMultiline()).toBe(true);
    expect(second.isReadOnly()).toBe(true);

    expect(form.getCheckBox('Agree').isChecked()).toBe(true);
    expect(form.getRadioGroup('Choice 1').getSelected()).toBe('No');
    expect(form.getDropdown('Country').getSelected()).toEqual(['Canada']);
  });

  it('falls back to NeedAppearances when Helvetica cannot draw a value', async () => {
    const out = await PDFDocument.load(await buildAcroFormPdf([page]));
    const need = out.getForm().acroForm.dict.get(PDFName.of('NeedAppearances'));
    expect(need).toBe(PDFBool.True);
  });

  it('puts the page text in an invisible, searchable layer', async () => {
    const out = await PDFDocument.load(await buildAcroFormPdf([page]));
    const contents = out.getPage(0).node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => out.context.lookup(ref))
        : [contents];
    const ops = streams
      .map((s) =>
        new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode())
      )
      .join('\n');
    // pdf-lib writes strings as hex: "Applicant".
    expect(ops).toMatch(/3 Tr[\s\S]*<4170706C6963616E74/);
  });
});
