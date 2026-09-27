import { pdfjs, viewerLib } from './pdf.ts';

export interface Viewer {
  eventBus: InstanceType<typeof viewerLib.EventBus>;
  linkService: InstanceType<typeof viewerLib.PDFLinkService>;
  findController: InstanceType<typeof viewerLib.PDFFindController>;
  pdfViewer: InstanceType<typeof viewerLib.PDFViewer>;
}

export interface ViewerEvents {
  onPagesInit(): void;
  onPageChange(): void;
  onScaleChange(): void;
  onFindCount(
    matches: { current: number; total: number } | null,
    notFound: boolean
  ): void;
}

const FIT_MODES = new Set(['auto', 'page-fit', 'page-width']);

export function createViewer(
  container: HTMLDivElement,
  events: ViewerEvents
): Viewer {
  const eventBus = new viewerLib.EventBus();
  const linkService = new viewerLib.PDFLinkService({
    eventBus,
    externalLinkTarget: viewerLib.LinkTarget.BLANK,
  });
  const findController = new viewerLib.PDFFindController({
    eventBus,
    linkService,
  });
  const pdfViewer = new viewerLib.PDFViewer({
    container,
    eventBus,
    linkService,
    findController,
    removePageBorders: true,
    annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
    // The viewer doesn't use pdf.js's editors. Leaving them on adds
    // document-wide drag/drop listeners that throw for hidden tabs.
    annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE,
  });
  linkService.setViewer(pdfViewer);

  // Re-fit when panes open/close or the window resizes.
  new ResizeObserver(() =>
    requestAnimationFrame(() => {
      const mode = pdfViewer.currentScaleValue;
      if (
        pdfViewer.pagesCount &&
        container.offsetParent &&
        FIT_MODES.has(mode)
      ) {
        pdfViewer.currentScaleValue = mode;
      }
    })
  ).observe(container);

  eventBus.on('pagesinit', () => events.onPagesInit());
  eventBus.on('pagechanging', () => events.onPageChange());
  eventBus.on('scalechanging', () => events.onScaleChange());
  eventBus.on(
    'updatefindmatchescount',
    ({ matchesCount }: { matchesCount: { current: number; total: number } }) =>
      events.onFindCount(matchesCount, false)
  );
  eventBus.on(
    'updatefindcontrolstate',
    ({
      state,
      matchesCount,
    }: {
      state: number;
      matchesCount: { current: number; total: number };
    }) => events.onFindCount(matchesCount, state === 1)
  );
  return { eventBus, linkService, findController, pdfViewer };
}

export function find(
  viewer: Viewer,
  query: string,
  again: boolean,
  previous: boolean
) {
  viewer.eventBus.dispatch('find', {
    source: null,
    type: again ? 'again' : '',
    query,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: previous,
    matchDiacritics: false,
  });
}
