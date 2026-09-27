import { findToolHost } from '@unsold/bridge/tool-host';

/**
 * Hands a result file to the user. Inside the Unsold PDF app the Studio takes
 * it (PDFs come back into the document, other files get a save dialog); a
 * standalone page falls back to a normal browser download.
 */
export function downloadFile(
  blob: Blob,
  filename: string,
  options: { asNew?: boolean } = {}
): void {
  const host = findToolHost();
  if (host) {
    void blob
      .arrayBuffer()
      .then((buf) =>
        host.deliverOutput(
          { name: filename, data: new Uint8Array(buf), asNew: options.asNew },
          window
        )
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
