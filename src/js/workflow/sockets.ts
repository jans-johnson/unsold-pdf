import { ClassicPreset } from 'rete';

export class PDFSocket extends ClassicPreset.Socket {
  constructor() {
    super('PDF');
  }
}

export const pdfSocket = new PDFSocket();
