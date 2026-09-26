import { findToolHost } from '@unacrobat/bridge/tool-host';

/**
 * Hands a result file to the user. Inside the UnAcrobat app the Studio takes
 * it (PDFs come back into the document, other files get a save dialog); a
 * standalone page falls back to a normal browser download.
 */
export function downloadFile(blob: Blob, filename: string): void {
  const host = findToolHost();
  if (host) {
    void blob
      .arrayBuffer()
      .then((buf) =>
        host.deliverOutput({ name: filename, data: new Uint8Array(buf) }, window)
      );
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
