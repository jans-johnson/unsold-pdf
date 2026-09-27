// Self-contained Form Filler logic for standalone page
import { createIcons, icons } from 'lucide';
import { getPDFDocument, getCleanPdfFilename } from '../utils/helpers.js';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import { downloadFile } from '../utils/deliver-output.js';
import { t } from '../i18n/i18n';
import { registerToolPage } from '@unsold/bridge/tool-host';
import {
  buildAcroFormPdf,
  detectXfa,
  removeXfa,
  snapshotXfaPages,
  type XfaKind,
  type XfaPdfDocument,
  type XfaViewerWindow,
} from '../utils/xfa-convert.js';

let viewerIframe: HTMLIFrameElement | null = null;
let viewerReady = false;
let currentFile: File | null = null;
let xfaKind: XfaKind = 'none';

// Closing the tool with values typed in asks to apply or discard.
registerToolPage({
  hasChanges: () => {
    const win = viewerIframe?.contentWindow as XfaViewerWindow | null;
    const storage = win?.PDFViewerApplication?.pdfDocument
      ?.annotationStorage as { size?: number } | undefined;
    return (storage?.size ?? 0) > 0;
  },
  apply: () => processAndDownloadForm(),
});
let saving = false;

// UI helpers
function showLoader(message: string = 'Processing...') {
  const loader = document.getElementById('loader-modal');
  const loaderText = document.getElementById('loader-text');
  if (loader) loader.classList.remove('hidden');
  if (loaderText) loaderText.textContent = message;
}

function hideLoader() {
  const loader = document.getElementById('loader-modal');
  if (loader) loader.classList.add('hidden');
}

function showAlert(
  title: string,
  message: string,
  type: string = 'error',
  callback?: () => void
) {
  const modal = document.getElementById('alert-modal');
  const alertTitle = document.getElementById('alert-title');
  const alertMessage = document.getElementById('alert-message');
  const okBtn = document.getElementById('alert-ok');

  if (alertTitle) alertTitle.textContent = title;
  if (alertMessage) alertMessage.textContent = message;
  if (modal) modal.classList.remove('hidden');

  if (okBtn) {
    const newOkBtn = okBtn.cloneNode(true) as HTMLElement;
    okBtn.replaceWith(newOkBtn);
    newOkBtn.addEventListener('click', () => {
      modal?.classList.add('hidden');
      if (callback) callback();
    });
  }
}

function updateFileDisplay() {
  const displayArea = document.getElementById('file-display-area');
  if (!displayArea || !currentFile) return;

  const fileSize =
    currentFile.size < 1024 * 1024
      ? `${(currentFile.size / 1024).toFixed(1)} KB`
      : `${(currentFile.size / 1024 / 1024).toFixed(2)} MB`;

  displayArea.textContent = '';

  const card = document.createElement('div');
  card.className =
    'bg-gray-700 p-3 rounded-lg border border-gray-600 hover:border-indigo-500 transition-colors';

  const row = document.createElement('div');
  row.className = 'flex items-center justify-between';

  const info = document.createElement('div');
  info.className = 'flex-1 min-w-0';

  const nameP = document.createElement('p');
  nameP.className = 'truncate font-medium text-white';
  nameP.textContent = currentFile.name;

  const sizeP = document.createElement('p');
  sizeP.className = 'text-gray-400 text-sm';
  sizeP.textContent = fileSize;

  info.append(nameP, sizeP);

  const removeBtn = document.createElement('button');
  removeBtn.id = 'remove-file';
  removeBtn.className =
    'text-red-400 hover:text-red-300 p-2 flex-shrink-0 ml-2';
  removeBtn.title = 'Remove file';

  const removeIcon = document.createElement('i');
  removeIcon.setAttribute('data-lucide', 'trash-2');
  removeIcon.className = 'w-4 h-4';
  removeBtn.appendChild(removeIcon);

  row.append(info, removeBtn);
  card.appendChild(row);
  displayArea.appendChild(card);

  createIcons({ icons });

  document
    .getElementById('remove-file')
    ?.addEventListener('click', () => resetState());
}

function resetState() {
  viewerIframe = null;
  viewerReady = false;
  currentFile = null;
  xfaKind = 'none';
  document.getElementById('xfa-notice')?.classList.add('hidden');
  const displayArea = document.getElementById('file-display-area');
  if (displayArea) displayArea.innerHTML = '';
  document.getElementById('form-filler-options')?.classList.add('hidden');
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (fileInput) fileInput.value = '';

  // Clear viewer
  const viewerContainer = document.getElementById('pdf-viewer-container');
  if (viewerContainer) {
    viewerContainer.innerHTML = '';
    viewerContainer.style.height = '';
    viewerContainer.style.aspectRatio = '';
  }

  const toolUploader = document.getElementById('tool-uploader');
  const isFullWidth = localStorage.getItem('fullWidthMode') !== 'false';
  if (toolUploader && !isFullWidth) {
    toolUploader.classList.remove('max-w-6xl');
    toolUploader.classList.add('max-w-2xl');
  }
}

// File handling
async function handleFileUpload(file: File) {
  if (!file || file.type !== 'application/pdf') {
    showAlert('Error', 'Please upload a valid PDF file.');
    return;
  }

  try {
    const result = await loadPdfWithPasswordPrompt(file);
    if (!result) return;
    result.pdf.destroy();
    currentFile = result.file;
    updateFileDisplay();
    await setupFormViewer();
  } catch (error) {
    console.error(error);
    showAlert('Error', 'Failed to load PDF file.');
    hideLoader();
  }
}

async function adjustViewerHeight(file: File) {
  const viewerContainer = document.getElementById('pdf-viewer-container');
  if (!viewerContainer) return;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = getPDFDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });

    // Add ~50px for toolbar height
    const aspectRatio = viewport.width / (viewport.height + 50);

    viewerContainer.style.height = 'auto';
    viewerContainer.style.aspectRatio = `${aspectRatio}`;
  } catch (e) {
    console.error('Error adjusting viewer height:', e);
    viewerContainer.style.height = '80vh';
  }
}

async function setupFormViewer() {
  if (!currentFile) return;

  showLoader('Loading PDF form...');
  const pdfViewerContainer = document.getElementById('pdf-viewer-container');

  if (!pdfViewerContainer) {
    console.error('PDF viewer container not found');
    hideLoader();
    return;
  }

  const toolUploader = document.getElementById('tool-uploader');
  // Default to true if not set
  const isFullWidth = localStorage.getItem('fullWidthMode') !== 'false';
  if (toolUploader && !isFullWidth) {
    toolUploader.classList.remove('max-w-2xl');
    toolUploader.classList.add('max-w-6xl');
  }

  try {
    // Apply dynamic height
    await adjustViewerHeight(currentFile);

    pdfViewerContainer.innerHTML = '';

    const arrayBuffer = await currentFile.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);

    viewerIframe = document.createElement('iframe');
    viewerIframe.src = `${import.meta.env.BASE_URL}pdfjs-viewer/viewer.html?file=${encodeURIComponent(blobUrl)}`;
    viewerIframe.style.width = '100%';
    viewerIframe.style.height = '100%';
    viewerIframe.style.border = 'none';

    const iframe = viewerIframe;
    iframe.onload = () => {
      viewerReady = true;
      hideLoader();
      void prepareViewer(iframe);
    };

    pdfViewerContainer.appendChild(viewerIframe);

    const formFillerOptions = document.getElementById('form-filler-options');
    if (formFillerOptions) formFillerOptions.classList.remove('hidden');
  } catch (e) {
    console.error('Critical error setting up form filler:', e);
    showAlert('Error', 'Failed to load PDF form viewer.');
    hideLoader();
  }
}

async function waitForPdfDocument(
  win: XfaViewerWindow
): Promise<XfaPdfDocument | null> {
  for (let i = 0; i < 600; i++) {
    const doc = win.PDFViewerApplication?.pdfDocument;
    if (doc) return doc;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/**
 * Once the viewer has the document: flag XFA forms, and route the viewer's
 * own download/save controls through our save so they convert too.
 */
async function prepareViewer(iframe: HTMLIFrameElement) {
  const win = iframe.contentWindow as XfaViewerWindow | null;
  if (!win) return;
  const doc = await waitForPdfDocument(win);
  if (!doc || iframe !== viewerIframe) return;

  win.document.addEventListener(
    'click',
    (e) => {
      const target = e.target as Element | null;
      if (!target?.closest('#downloadButton, #secondaryDownload')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void processAndDownloadForm();
    },
    true
  );
  if (win.PDFViewerApplication) {
    win.PDFViewerApplication.downloadOrSave = () => processAndDownloadForm();
  }

  try {
    xfaKind = await detectXfa(doc);
  } catch (e) {
    console.warn('Could not detect XFA:', e);
    xfaKind = 'none';
  }
  const notice = document.getElementById('xfa-notice');
  const noticeText = document.getElementById('xfa-notice-text');
  if (notice && noticeText && xfaKind !== 'none') {
    noticeText.textContent =
      xfaKind === 'pure'
        ? t('tools:pdfFormFiller.xfaPureNotice')
        : t('tools:pdfFormFiller.xfaHybridNotice');
    notice.classList.remove('hidden');
  }
}

async function saveFilledPdf(win: XfaViewerWindow): Promise<Uint8Array> {
  const app = win.PDFViewerApplication;
  const doc = app?.pdfDocument;
  if (!app || !doc) throw new Error('PDF viewer is not ready');

  const keepXfa =
    (document.getElementById('keep-xfa') as HTMLInputElement | null)?.checked ??
    false;

  if (xfaKind === 'pure' && !keepXfa) {
    const pages = await snapshotXfaPages(win, (page, total) =>
      showLoader(t('tools:pdfFormFiller.convertingPage', { page, total }))
    );
    showLoader(t('tools:pdfFormFiller.buildingPdf'));
    return buildAcroFormPdf(
      pages,
      getCleanPdfFilename(currentFile?.name ?? '')
    );
  }

  await app.pdfScriptingManager?.dispatchWillSave();
  let data: Uint8Array;
  try {
    data =
      doc.annotationStorage.size > 0
        ? await doc.saveDocument()
        : await doc.getData();
  } finally {
    await app.pdfScriptingManager?.dispatchDidSave();
  }

  if (xfaKind === 'hybrid' && !keepXfa) {
    showLoader(t('tools:pdfFormFiller.buildingPdf'));
    return removeXfa(data);
  }
  return data;
}

async function processAndDownloadForm() {
  if (!viewerIframe || !viewerReady) {
    showAlert(
      'Viewer not ready',
      'Please wait for the form to finish loading.'
    );
    return;
  }
  const win = viewerIframe.contentWindow as XfaViewerWindow | null;
  if (!win?.PDFViewerApplication?.pdfDocument) {
    showAlert(
      'Viewer not ready',
      'Please wait for the form to finish loading.'
    );
    return;
  }
  if (saving) return;
  saving = true;

  showLoader('Saving form...');
  try {
    const data = await saveFilledPdf(win);
    const name = `${getCleanPdfFilename(currentFile?.name ?? 'form') || 'form'}.pdf`;
    downloadFile(
      new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
      name
    );
  } catch (e) {
    console.error('Failed to save form:', e);
    showAlert(
      'Error',
      'Could not save the filled form. ' +
        (e instanceof Error ? e.message : String(e))
    );
  } finally {
    saving = false;
    hideLoader();
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');
  const backBtn = document.getElementById('back-to-tools');

  fileInput?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) handleFileUpload(file);
  });

  dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-indigo-500');
  });

  dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-indigo-500');
  });

  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-indigo-500');
    const file = e.dataTransfer?.files[0];
    if (file) handleFileUpload(file);
  });

  processBtn?.addEventListener('click', processAndDownloadForm);

  backBtn?.addEventListener('click', () => {
    window.location.href = '../../index.html';
  });
});
