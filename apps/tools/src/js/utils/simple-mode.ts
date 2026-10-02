/**
 * Simple mode (Studio on a phone, the default there): tool pages drop their
 * card chrome and the embedded PDF viewer keeps only the tools that matter.
 * See apps/studio/src/simple.ts.
 */

/** True when the Studio around this page shows its simple phone layout. */
export function inSimpleMode(): boolean {
  try {
    const top = window.top;
    return (
      !!top &&
      top !== window &&
      top.document.documentElement.dataset.mode === 'simple' &&
      top.matchMedia('(max-width: 760px)').matches
    );
  } catch {
    return false;
  }
}

/** Marks the page (styles.css `[data-simple]`) when in simple mode. */
export function markSimpleMode(): boolean {
  const on = inSimpleMode();
  if (on) {
    document.documentElement.dataset.simple = '';
    const save = document.getElementById('process-btn');
    if (save) save.textContent = 'Save';
  }
  return on;
}

/**
 * Trims an embedded PDF.js viewer's toolbar to the editing tools: no
 * sidebar, search, page box or zoom buttons (pinch zooms), no highlight or
 * comment. Text, draw, signature, image and save stay.
 */
export function simplifyViewer(doc: Document) {
  if (!inSimpleMode() || doc.getElementById('ua-simple-viewer')) return;
  const style = doc.createElement('style');
  style.id = 'ua-simple-viewer';
  style.textContent = `
    #toolbarViewerLeft, #toolbarViewerMiddle,
    #editorHighlight, #editorComment, #editorModeSeparator,
    #secondaryToolbarToggle, #printButton { display: none !important; }
    #toolbarViewer #toolbarViewerRight {
      flex: 1; display: flex; justify-content: space-evenly; margin: 0;
    }
    #toolbarViewerRight #editorModeButtons {
      display: flex; flex: 1; justify-content: space-evenly;
    }
    #toolbarViewerRight .toolbarButton { min-width: 44px; height: 40px; }

    /* Each tool's options open as a full-width strip under the toolbar,
       instead of a pop-up hanging off the button (and the screen edge). */
    .editorParamsToolbar {
      position: fixed !important;
      top: calc(var(--toolbar-height, 32px) + 6px) !important;
      left: 8px !important;
      right: 8px !important;
      inset-inline: 8px !important;
      width: auto !important;
      max-width: none !important;
    }
    .editorParamsToolbar::before, .editorParamsToolbar::after { display: none !important; }
    .editorParamsToolbar .editorParamsLabel,
    .editorParamsToolbar .toolbarButton.labeled { color: #1c1c1c !important; }
    #editorSignatureAddSignature, #editorStampAddImage {
      width: 100% !important;
      justify-content: flex-start !important;
      gap: 8px;
      font-size: 14px;
    }
    #editorSignatureAddSignature::before, #editorStampAddImage::before {
      background-color: #1c1c1c !important;
    }

    /* The "Add a signature" dialog fits the phone. */
    #addSignatureDialog { max-width: calc(100vw - 16px) !important; }
    #addSignatureTypeInput,
    #addSignatureTypeInput::placeholder { font-size: 24px !important; }
    #editorSignatureAddSignature > span,
    #editorStampAddImage > span {
      width: auto !important;
      height: auto !important;
      overflow: visible !important;
    }
  `;
  doc.head.append(style);
}
