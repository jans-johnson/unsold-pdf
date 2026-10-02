import { markSimpleMode, simplifyViewer } from '../utils/simple-mode.js';
import { createIcons, icons } from 'lucide';
import { showAlert, showLoader, hideLoader } from '../ui.js';
import {
  readFileAsArrayBuffer,
  formatBytes,
  downloadFile,
} from '../utils/helpers.js';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import { t } from '../i18n/i18n';
import { loadPdfDocument } from '../utils/load-pdf-document.js';
import { flattenAnnotations } from '../utils/flatten-annotations.js';
import type { SignState, PDFViewerWindow } from '@/types';
import { registerToolPage } from '@unsold/bridge/tool-host';

// pdf.js ships its editor buttons as bare grey icons. Show their labels and
// make "Add signature" the obvious primary action. Labels drop off the
// secondary buttons when the toolbar gets narrow so the zoom menu still fits.
function editorToolbarCss(accent: string, accentHover: string): string {
  return `
  #editorModeButtons { gap: 4px; }
  #editorModeButtons .toolbarButton {
    aspect-ratio: auto;
    width: auto;
    gap: 6px;
    padding: 0 10px 0 8px;
    border-radius: 6px;
    --toolbar-icon-opacity: 1;
  }
  #editorModeButtons .toolbarButton > span {
    width: auto;
    height: auto;
    overflow: visible;
    white-space: nowrap;
    font: 500 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  #editorModeButtons #editorSignatureButton {
    background-color: ${accent};
    color: #fff;
    margin-inline-end: 6px;
  }
  #editorModeButtons #editorSignatureButton::before { background-color: #fff; }
  #editorModeButtons #editorSignatureButton > span { font-weight: 600; }
  #editorModeButtons #editorSignatureButton:is(:hover, :focus-visible, .toggled) {
    background-color: ${accentHover};
  }
  #editorModeButtons #editorSignatureButton.toggled {
    outline: 2px solid #fff !important;
    outline-offset: -2px;
  }
  @media (max-width: 1280px) {
    #editorModeButtons .toolbarButton:not(#editorSignatureButton) {
      aspect-ratio: 1;
      padding: 0;
    }
    #editorModeButtons .toolbarButton:not(#editorSignatureButton) > span {
      width: 0;
      height: 0;
      overflow: hidden;
    }
  }
  @media (max-width: 700px) {
    #editorModeButtons #editorSignatureButton > span { display: none; }
    #editorModeButtons #editorSignatureButton { aspect-ratio: 1; padding: 0; }
  }
  `;
}

function injectEditorToolbarStyle(doc: Document) {
  if (doc.getElementById('ua-sign-toolbar')) return;
  const root = getComputedStyle(document.documentElement);
  const accent =
    root.getPropertyValue('--color-indigo-600').trim() || '#4f46e5';
  const accentHover =
    root.getPropertyValue('--color-indigo-700').trim() || '#4338ca';
  const style = doc.createElement('style');
  style.id = 'ua-sign-toolbar';
  style.textContent = editorToolbarCss(accent, accentHover);
  doc.head.append(style);
}

const signState: SignState = {
  file: null,
  pdfDoc: null,
  viewerIframe: null,
  viewerReady: false,
  blobUrl: null,
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePage);
} else {
  initializePage();
}

/** Unsaved signatures, so closing the tool asks before throwing them away. */
function signaturesPlaced(): boolean {
  const win = signState.viewerIframe?.contentWindow as PDFViewerWindow | null;
  const storage = win?.PDFViewerApplication?.pdfDocument?.annotationStorage as
    | { size?: number }
    | undefined;
  return (storage?.size ?? 0) > 0;
}

function initializePage() {
  if (markSimpleMode()) {
    const tip = document.querySelector('#signature-editor > p');
    if (tip)
      tip.textContent =
        'Tap the signature button, make or pick your signature, then tap where it goes.';
  }
  registerToolPage({
    hasChanges: signaturesPlaced,
    apply: () => applyAndSaveSignatures(),
  });
  createIcons({ icons });

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');

  if (fileInput) {
    fileInput.addEventListener('change', handleFileUpload);
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('bg-gray-700');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('bg-gray-700');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
      const droppedFiles = e.dataTransfer?.files;
      if (droppedFiles && droppedFiles.length > 0) {
        handleFile(droppedFiles[0]);
      }
    });

    // Clear value on click to allow re-selecting the same file
    fileInput?.addEventListener('click', () => {
      if (fileInput) fileInput.value = '';
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', applyAndSaveSignatures);
  }

  document.getElementById('back-to-tools')?.addEventListener('click', () => {
    cleanup();
    window.location.href = import.meta.env.BASE_URL;
  });
}

function handleFileUpload(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    handleFile(input.files[0]);
  }
}

function handleFile(file: File) {
  if (
    file.type !== 'application/pdf' &&
    !file.name.toLowerCase().endsWith('.pdf')
  ) {
    showAlert('Invalid File', 'Please select a PDF file.');
    return;
  }

  signState.file = file;
  updateFileDisplay();
  setupSignTool();
}

async function updateFileDisplay() {
  const fileDisplayArea = document.getElementById('file-display-area');

  if (!fileDisplayArea || !signState.file) return;

  fileDisplayArea.innerHTML = '';

  const fileDiv = document.createElement('div');
  fileDiv.className =
    'flex items-center justify-between bg-gray-700 p-3 rounded-lg';

  const infoContainer = document.createElement('div');
  infoContainer.className = 'flex flex-col flex-1 min-w-0';

  const nameSpan = document.createElement('div');
  nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
  nameSpan.textContent = signState.file.name;

  const metaSpan = document.createElement('div');
  metaSpan.className = 'text-xs text-gray-400';
  metaSpan.textContent = `${formatBytes(signState.file.size)} • ${t('common.loadingPageCount')}`;

  infoContainer.append(nameSpan, metaSpan);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'ml-4 text-red-400 hover:text-red-300 flex-shrink-0';
  removeBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
  removeBtn.onclick = () => {
    signState.file = null;
    signState.pdfDoc = null;
    fileDisplayArea.innerHTML = '';
    document.getElementById('signature-editor')?.classList.add('hidden');
  };

  fileDiv.append(infoContainer, removeBtn);
  fileDisplayArea.appendChild(fileDiv);
  createIcons({ icons });

  const result = await loadPdfWithPasswordPrompt(signState.file);
  if (!result) {
    signState.file = null;
    signState.pdfDoc = null;
    fileDisplayArea.innerHTML = '';
    document.getElementById('signature-editor')?.classList.add('hidden');
    return;
  }
  signState.file = result.file;
  nameSpan.textContent = result.file.name;
  metaSpan.textContent = `${formatBytes(result.file.size)} • ${result.pdf.numPages} pages`;
  result.pdf.destroy();
}

async function setupSignTool() {
  const signatureEditor = document.getElementById('signature-editor');
  if (signatureEditor) {
    signatureEditor.classList.remove('hidden');
  }

  showLoader('Loading PDF viewer...');

  const container = document.getElementById('canvas-container-sign');
  if (!container) {
    console.error('Sign tool canvas container not found');
    hideLoader();
    return;
  }

  if (!signState.file) {
    console.error('No file loaded for signing');
    hideLoader();
    return;
  }

  container.textContent = '';
  const iframe = document.createElement('iframe');
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  container.appendChild(iframe);
  signState.viewerIframe = iframe;

  const pdfBytes = await readFileAsArrayBuffer(signState.file);
  const blob = new Blob([new Uint8Array(pdfBytes as ArrayBuffer)], {
    type: 'application/pdf',
  });
  signState.blobUrl = URL.createObjectURL(blob);

  try {
    const existingPrefsRaw = localStorage.getItem('pdfjs.preferences');
    const existingPrefs: Record<string, unknown> = existingPrefsRaw
      ? JSON.parse(existingPrefsRaw)
      : {};
    delete existingPrefs.annotationEditorMode;
    const newPrefs = {
      ...existingPrefs,
      enableSignatureEditor: true,
      enablePermissions: false,
    };
    localStorage.setItem('pdfjs.preferences', JSON.stringify(newPrefs));
  } catch (e) {
    console.warn('Failed to update pdfjs.preferences in localStorage', e);
  }

  const viewerUrl = new URL(
    `${import.meta.env.BASE_URL}pdfjs-viewer/viewer.html`,
    window.location.origin
  );
  const query = new URLSearchParams({ file: signState.blobUrl });
  iframe.src = `${viewerUrl.toString()}?${query.toString()}`;

  iframe.onload = () => {
    hideLoader();
    signState.viewerReady = true;
    try {
      const viewerWindow = iframe.contentWindow as PDFViewerWindow | null;
      if (viewerWindow && viewerWindow.PDFViewerApplication) {
        const app = viewerWindow.PDFViewerApplication;
        const doc = viewerWindow.document;
        const eventBus = app.eventBus;
        injectEditorToolbarStyle(doc);
        simplifyViewer(doc);
        // The viewer's own download/save controls save through us too.
        doc.addEventListener(
          'click',
          (e) => {
            const target = e.target as Element | null;
            if (!target?.closest('#downloadButton, #secondaryDownload')) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            void applyAndSaveSignatures();
          },
          true
        );
        (app as { downloadOrSave?: () => unknown }).downloadOrSave = () =>
          applyAndSaveSignatures();
        eventBus?._on('annotationeditoruimanager', () => {
          const editorModeButtons = doc.getElementById('editorModeButtons');
          editorModeButtons?.classList.remove('hidden');
          const editorSignature = doc.getElementById('editorSignature');
          editorSignature?.removeAttribute('hidden');
          const editorSignatureButton = doc.getElementById(
            'editorSignatureButton'
          ) as HTMLButtonElement | null;
          if (editorSignatureButton) {
            editorSignatureButton.disabled = false;
          }
          const editorStamp = doc.getElementById('editorStamp');
          editorStamp?.removeAttribute('hidden');
          const editorStampButton = doc.getElementById(
            'editorStampButton'
          ) as HTMLButtonElement | null;
          if (editorStampButton) {
            editorStampButton.disabled = false;
          }
          try {
            const highlightBtn = doc.getElementById(
              'editorHighlightButton'
            ) as HTMLButtonElement | null;
            highlightBtn?.click();
          } catch (e) {
            console.warn(
              'Failed to auto-click highlight button in PDF viewer',
              e
            );
          }
        });
      }
    } catch (e) {
      console.error('Could not initialize PDF.js viewer for signing:', e);
    }

    const saveBtn = document.getElementById(
      'process-btn'
    ) as HTMLButtonElement | null;
    if (saveBtn) {
      saveBtn.style.display = '';
    }
  };
}

async function applyAndSaveSignatures() {
  if (!signState.viewerReady || !signState.viewerIframe) {
    showAlert('Viewer not ready', 'Please wait for the PDF viewer to load.');
    return;
  }

  try {
    const viewerWindow = signState.viewerIframe
      .contentWindow as PDFViewerWindow | null;
    if (!viewerWindow || !viewerWindow.PDFViewerApplication) {
      showAlert('Viewer not ready', 'The PDF viewer is still initializing.');
      return;
    }

    const app = viewerWindow.PDFViewerApplication;
    const flattenCheckbox = document.getElementById(
      'flatten-signature-toggle'
    ) as HTMLInputElement | null;
    const shouldFlatten = flattenCheckbox?.checked;

    if (shouldFlatten) {
      showLoader('Flattening and saving PDF...');

      const rawPdfBytes = await app.pdfDocument.saveDocument(
        app.pdfDocument.annotationStorage
      );
      const pdfBytes = new Uint8Array(rawPdfBytes);
      const pdfDoc = await loadPdfDocument(pdfBytes);
      try {
        pdfDoc.getForm().flatten();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes('getForm')) {
          throw e;
        }
      }
      try {
        flattenAnnotations(pdfDoc);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('Could not flatten annotations:', msg);
      }
      const flattenedPdfBytes = await pdfDoc.save();

      const blob = new Blob([new Uint8Array(flattenedPdfBytes)], {
        type: 'application/pdf',
      });
      downloadFile(blob, signState.file?.name || 'document.pdf');

      hideLoader();
      showAlert('Success', 'Signed PDF saved successfully!', 'success', () => {
        resetState();
      });
    } else {
      // Save through our own delivery (the viewer's download button goes to
      // a browser download, which never reaches the app).
      showLoader('Saving PDF...');
      const rawPdfBytes = await app.pdfDocument.saveDocument(
        app.pdfDocument.annotationStorage
      );
      downloadFile(
        new Blob([new Uint8Array(rawPdfBytes)], { type: 'application/pdf' }),
        signState.file?.name || 'document.pdf'
      );
      hideLoader();
      showAlert('Success', 'Signed PDF saved successfully!', 'success', () => {
        resetState();
      });
    }
  } catch (error) {
    console.error('Failed to export the signed PDF:', error);
    hideLoader();
    showAlert(
      'Export failed',
      'Could not export the signed PDF. Please try again.'
    );
  }
}

function resetState() {
  cleanup();
  signState.file = null;
  signState.viewerIframe = null;
  signState.viewerReady = false;

  const signatureEditor = document.getElementById('signature-editor');
  if (signatureEditor) {
    signatureEditor.classList.add('hidden');
  }

  const container = document.getElementById('canvas-container-sign');
  if (container) {
    container.textContent = '';
  }

  const fileDisplayArea = document.getElementById('file-display-area');
  if (fileDisplayArea) {
    fileDisplayArea.innerHTML = '';
  }

  const processBtn = document.getElementById(
    'process-btn'
  ) as HTMLButtonElement | null;
  if (processBtn) {
    processBtn.style.display = 'none';
  }

  const flattenCheckbox = document.getElementById(
    'flatten-signature-toggle'
  ) as HTMLInputElement | null;
  if (flattenCheckbox) {
    flattenCheckbox.checked = false;
  }
}

function cleanup() {
  if (signState.blobUrl) {
    URL.revokeObjectURL(signState.blobUrl);
    signState.blobUrl = null;
  }
}
