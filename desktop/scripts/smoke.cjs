'use strict';
// Visual smoke test: boots the real app, drives a few flows and writes
// screenshots. Usage: SMOKE_PDF=a.pdf SMOKE_OUT=dir npx electron scripts/smoke.cjs
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const { SMOKE_PDF: samplePdf, SMOKE_OUT: outDir } = process.env;
fs.mkdirSync(outDir, { recursive: true });

require('../main.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('browser-window-created', (_e, win) => {
  const wc = win.webContents;
  const logs = [];
  wc.on('console-message', (e) => logs.push(`[${e.level}] ${e.message}`));
  const shot = async (name) => {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
  };
  const js = (code) => wc.executeJavaScript(code);

  wc.once('did-finish-load', async () => {
    try {
      await wait(1500);
      await shot('01-home');

      const data = fs.readFileSync(samplePdf);
      wc.send('files:open', [{ path: samplePdf, name: path.basename(samplePdf), data: new Uint8Array(data) }]);
      await wait(2500);
      await shot('02-document');

      await js(`document.querySelector('#right-rail [data-panel=thumbnails]').click()`);
      await wait(1500);
      await shot('03-thumbnails');

      await js(`document.querySelector('#find-input').value='Revenue'; document.querySelector('#find-input').dispatchEvent(new Event('input'))`);
      await wait(1200);
      await shot('04-find');

      await js(`document.querySelector('#quick-rail [data-tool="compress-pdf"]').click()`);
      await wait(5000);
      await shot('05-tool-compress');
      const injected = await js(`(() => { const f = document.querySelector('.tool-frame-wrap iframe'); const i = f?.contentDocument?.querySelector('#file-input'); return i ? i.files.length : -1 })()`);
      logs.push(`injected files: ${injected}`);

      await js(`document.querySelector('.tool-frame-wrap iframe').contentDocument.querySelector('#process-btn').click()`);
      await wait(8000);
      await shot('05b-after-compress');
      const after = await js(`({ toolOpen: !!document.querySelector('.tool-frame-wrap'), dirty: !!document.querySelector('.dirty-dot'), toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent) })`);
      logs.push(`after compress: ${JSON.stringify(after)}`);

      const proxy = await js(`fetch('/cors-proxy?url=' + encodeURIComponent('https://example.com/')).then(r => r.status + ' ' + r.headers.get('content-type'))`);
      logs.push(`cors-proxy: ${proxy}`);
      logs.push(`title: ${await js('document.title')}`);

      await js(`document.querySelector('[data-tab=tools]').click()`);
      await wait(800);
      await shot('06-all-tools');

      await js(`document.querySelector('.tool-card').click()`);
      await wait(4000);
      await shot('07-tool-tab');
    } catch (err) {
      logs.push(`SMOKE ERROR: ${err.stack || err}`);
    }
    fs.writeFileSync(path.join(outDir, 'console.log'), logs.join('\n'));
    app.exit(0);
  });
});
