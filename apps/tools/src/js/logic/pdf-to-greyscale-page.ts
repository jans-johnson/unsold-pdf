import { showLoader, hideLoader, showAlert } from '../ui.js';
import {
  downloadFile,
  formatBytes,
  readFileAsArrayBuffer,
  getPDFDocument,
} from '../utils/helpers.js';
import { createIcons, icons } from 'lucide';
import { PDFDocument } from 'pdf-lib';
import { loadPyMuPDF } from '../utils/pymupdf-loader.js';
import { applyGreyscale } from '../utils/image-effects.js';
import { t } from '../i18n/i18n';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import '../utils/setup-pdf-worker.js';

let files: File[] = [];

const updateUI = () => {
  const fileDisplayArea = document.getElementById('file-display-area');
  const optionsPanel = document.getElementById('options-panel');
  const dropZone = document.getElementById('drop-zone');

  if (!fileDisplayArea || !optionsPanel || !dropZone) return;

  fileDisplayArea.innerHTML = '';

  if (files.length > 0) {
    optionsPanel.classList.remove('hidden');

    // Render files synchronously first
    files.forEach((file) => {
      const fileDiv = document.createElement('div');
      fileDiv.className =
        'flex items-center justify-between bg-gray-700 p-3 rounded-lg text-sm';

      const infoContainer = document.createElement('div');
      infoContainer.className = 'flex flex-col overflow-hidden';

      const nameSpan = document.createElement('div');
      nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
      nameSpan.textContent = file.name;

      const metaSpan = document.createElement('div');
      metaSpan.className = 'text-xs text-gray-400';
      metaSpan.textContent = `${formatBytes(file.size)} • ${t('common.loadingPageCount')}`; // Initial state

      infoContainer.append(nameSpan, metaSpan);

      const removeBtn = document.createElement('button');
      removeBtn.className =
        'ml-4 text-red-400 hover:text-red-300 flex-shrink-0';
      removeBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
      removeBtn.onclick = () => {
        files = [];
        updateUI();
      };

      fileDiv.append(infoContainer, removeBtn);
      fileDisplayArea.appendChild(fileDiv);

      // Fetch page count asynchronously
      readFileAsArrayBuffer(file)
        .then((buffer) => {
          return getPDFDocument(buffer).promise;
        })
        .then((pdf) => {
          metaSpan.textContent = `${formatBytes(file.size)} • ${pdf.numPages} ${pdf.numPages !== 1 ? t('common.pages') : t('common.page')}`;
        })
        .catch((e) => {
          console.warn('Error loading PDF page count:', e);
          metaSpan.textContent = formatBytes(file.size);
        });
    });

    // Initialize icons immediately after synchronous render
    createIcons({ icons });
  } else {
    optionsPanel.classList.add('hidden');
  }
};

const resetState = () => {
  files = [];
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (fileInput) fileInput.value = '';
  updateUI();
};

interface Pyodide {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
  runPython(code: string): unknown;
}

/** Greyscale every page's content (text, vectors and images) with MuPDF. */
async function greyscaleVector(bytes: Uint8Array): Promise<Uint8Array> {
  const pymupdf = (await loadPyMuPDF()) as unknown as {
    getPyodide(): Promise<Pyodide>;
  };
  const py = await pymupdf.getPyodide();
  const id = Date.now();
  const input = `/grey_in_${id}.pdf`;
  const output = `/grey_out_${id}.pdf`;
  py.FS.writeFile(input, bytes);
  try {
    py.runPython(`
import pymupdf
doc = pymupdf.open("${input}")
for page in doc:
    page.recolor(1)
doc.save("${output}", garbage=3, deflate=True)
doc.close()
`);
    return py.FS.readFile(output);
  } finally {
    for (const path of [input, output]) {
      try {
        py.FS.unlink(path);
      } catch {
        /* already gone */
      }
    }
  }
}

async function convert() {
  if (files.length === 0) {
    showAlert('No File', 'Please upload a PDF file first.');
    return;
  }
  try {
    const result = await loadPdfWithPasswordPrompt(files[0], files, 0);
    if (!result) return;
    showLoader('Converting to greyscale...');
    const { pdf: pdfjsDoc } = result;

    // Preferred: recolour the page content itself (MuPDF), so text stays
    // text and the file stays small. Falls back to images if that fails.
    try {
      const grey = await greyscaleVector(await pdfjsDoc.getData());
      downloadFile(
        new Blob([new Uint8Array(grey)], { type: 'application/pdf' }),
        files[0]?.name || 'document.pdf'
      );
      showAlert(
        'Success',
        'PDF converted to greyscale successfully!',
        'success',
        () => resetState()
      );
      return;
    } catch (err) {
      console.warn(
        'Vector greyscale unavailable; rendering pages instead',
        err
      );
    }

    const newPdfDoc = await PDFDocument.create();

    for (let i = 1; i <= pdfjsDoc.numPages; i++) {
      const page = await pdfjsDoc.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context!, viewport: viewport, canvas })
        .promise;

      const imageData = context!.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );
      applyGreyscale(imageData);
      context!.putImageData(imageData, 0, 0);

      const jpegBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.9)
      );

      if (jpegBlob) {
        const jpegBytes = await jpegBlob.arrayBuffer();
        const jpegImage = await newPdfDoc.embedJpg(jpegBytes);
        // Rendered at a higher scale for quality; the page keeps its size.
        const size = page.getViewport({ scale: 1 });
        const newPage = newPdfDoc.addPage([size.width, size.height]);
        newPage.drawImage(jpegImage, {
          x: 0,
          y: 0,
          width: size.width,
          height: size.height,
        });
      }
    }

    const resultBytes = await newPdfDoc.save();
    downloadFile(
      new Blob([new Uint8Array(resultBytes)], { type: 'application/pdf' }),
      files[0]?.name || 'document.pdf'
    );
    showAlert(
      'Success',
      'PDF converted to greyscale successfully!',
      'success',
      () => {
        resetState();
      }
    );
  } catch (e) {
    console.error(e);
    showAlert(
      'Error',
      'Failed to convert PDF to greyscale. The file might be corrupted.'
    );
  } finally {
    hideLoader();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');
  const backBtn = document.getElementById('back-to-tools');

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = import.meta.env.BASE_URL;
    });
  }

  const handleFileSelect = (newFiles: FileList | null) => {
    if (!newFiles || newFiles.length === 0) return;
    const validFiles = Array.from(newFiles).filter(
      (file) => file.type === 'application/pdf'
    );

    if (validFiles.length === 0) {
      showAlert('Invalid File', 'Please upload a PDF file.');
      return;
    }

    files = [validFiles[0]];
    updateUI();
  };

  if (fileInput && dropZone) {
    fileInput.addEventListener('change', (e) => {
      handleFileSelect((e.target as HTMLInputElement).files);
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('bg-gray-700');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
      handleFileSelect(e.dataTransfer?.files ?? null);
    });

    fileInput.addEventListener('click', () => {
      fileInput.value = '';
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', convert);
  }
});
