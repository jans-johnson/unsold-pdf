let cpdfLoaded = false;

function loadCpdf(cpdfUrl) {
  if (cpdfLoaded) return Promise.resolve();

  return new Promise((resolve, reject) => {
    if (typeof coherentpdf !== 'undefined') {
      cpdfLoaded = true;
      resolve();
      return;
    }

    try {
      self.importScripts(cpdfUrl);
      cpdfLoaded = true;
      resolve();
    } catch (error) {
      reject(new Error('Failed to load CoherentPDF: ' + error.message));
    }
  });
}

// cpdf writes PDF strings as raw bytes (e.g. UTF-16 metadata with 0xFE 0xFF),
// which isn't valid UTF-8, so strict JSON parsers reject the file. Read the
// bytes as Latin-1 and write real UTF-8; json-to-pdf.worker.js reverses it.
function latin1ToUtf8(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return new TextEncoder().encode(text);
}

function convertPDFsToJSONInWorker(fileBuffers, fileNames) {
  try {
    const jsonFiles = [];
    const transferBuffers = [];

    for (let i = 0; i < fileBuffers.length; i++) {
      const buffer = fileBuffers[i];
      const fileName = fileNames[i];
      const uint8Array = new Uint8Array(buffer);
      const pdf = coherentpdf.fromMemory(uint8Array, '');

      const jsonData = coherentpdf.outputJSONMemory(true, false, false, pdf);

      const jsonBuffer = latin1ToUtf8(jsonData).buffer;
      jsonFiles.push({
        name: fileName,
        data: jsonBuffer,
      });
      transferBuffers.push(jsonBuffer);

      coherentpdf.deletePdf(pdf);
    }

    self.postMessage(
      {
        status: 'success',
        jsonFiles: jsonFiles,
      },
      transferBuffers
    );
  } catch (error) {
    self.postMessage({
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Unknown error during PDF to JSON conversion.',
    });
  }
}

self.onmessage = async function (e) {
  const { cpdfUrl } = e.data;

  if (!cpdfUrl) {
    self.postMessage({
      status: 'error',
      message:
        'CoherentPDF URL not provided. Please configure it in WASM Settings.',
    });
    return;
  }

  try {
    await loadCpdf(cpdfUrl);
  } catch (error) {
    self.postMessage({
      status: 'error',
      message: error.message,
    });
    return;
  }

  if (e.data.command === 'convert') {
    convertPDFsToJSONInWorker(e.data.fileBuffers, e.data.fileNames);
  }
};
