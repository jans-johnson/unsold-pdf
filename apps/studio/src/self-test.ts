import type { SelfTestCheck, SelfTestHost } from '@unsold/bridge';
import type { Studio } from './studio.ts';

// A one-page PDF, small enough to inline.
const TINY_PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj ' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';

const until = async (test: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

/** Each check gets its own deadline, so a hang is reported by name. */
const CHECK_TIMEOUT_MS = 25_000;

async function check(
  name: string,
  run: () => Promise<boolean | string>
): Promise<SelfTestCheck> {
  try {
    const result = await Promise.race([
      run(),
      new Promise<string>((resolve) =>
        setTimeout(
          () => resolve(`timed out after ${CHECK_TIMEOUT_MS / 1000}s`),
          CHECK_TIMEOUT_MS
        )
      ),
    ]);
    return result === true
      ? { name, ok: true }
      : { name, ok: false, detail: String(result) };
  } catch (err) {
    return { name, ok: false, detail: (err as Error).message ?? String(err) };
  }
}

/** Launch-time smoke checks for `--self-test`; results go back to the host. */
export async function runSelfTest(studio: Studio, host: SelfTestHost) {
  const checks = [
    await check('cross-origin isolated', async () => {
      if (crossOriginIsolated) return true;
      const res = await fetch(location.href);
      const coop = res.headers.get('cross-origin-opener-policy');
      const coep = res.headers.get('cross-origin-embedder-policy');
      return `not isolated (origin ${location.origin}, secure=${isSecureContext}, COOP=${coop}, COEP=${coep})`;
    }),
    await check('WebAssembly threads', async () => {
      // What the Office converters (LibreOffice) and wasm-vips need.
      new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
      return typeof SharedArrayBuffer !== 'undefined' || 'no SharedArrayBuffer';
    }),
    await check('host IPC', async () =>
      Array.isArray(await studio.host.listRecents())
    ),
    await check('engines bundled', async () => {
      for (const url of [
        '/wasm/cpdf/dist/coherentpdf.browser.min.js',
        '/wasm/pymupdf/package.json',
        '/wasm/gs/package.json',
      ]) {
        const res = await fetch(url);
        if (!res.ok) return `${url}: HTTP ${res.status}`;
      }
      return true;
    }),
    await check('PDF viewer renders', async () => {
      studio.openDocument({
        name: 'self-test.pdf',
        handle: null,
        data: new TextEncoder().encode(TINY_PDF),
      });
      return (
        (await until(
          () => !!document.querySelector('.pdfViewer .page canvas'),
          15000
        )) || 'no page canvas'
      );
    }),
    await check('tool page loads', async () => {
      studio.openToolTab('merge-pdf');
      const ready = await until(() => {
        const frame = document.querySelector<HTMLIFrameElement>(
          '.tab-stage:not([hidden]) iframe'
        );
        return !!frame?.contentDocument?.querySelector('input[type=file]');
      }, 20000);
      return ready || 'merge-pdf page did not show its file input';
    }),
  ];
  await host.report(checks);
}
