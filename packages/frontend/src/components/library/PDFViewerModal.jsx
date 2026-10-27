import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import { 
  X, 
  Download, 
  Loader2, 
  BookOpen, 
  Maximize2, 
  Minimize2, 
  ExternalLink, 
  AlertCircle, 
  RefreshCw,
  FileText,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ZoomIn,
  ZoomOut,
  Monitor,
  Smartphone,
  Keyboard,
  HelpCircle
} from 'lucide-react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure the worker explicitly for Vite environments
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

export function PDFViewerModal({ item, onClose, onDownload }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [blobUrl, setBlobUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // PDF State Machine
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [scale, setScale] = useState(1.0);
  const [isFitWidth, setIsFitWidth] = useState(true);
  const [containerWidth, setContainerWidth] = useState(800);
  const [viewMode, setViewMode] = useState('canvas'); // 'canvas' (reader) | 'iframe' (native desktop plugin)
  const [isMobile, setIsMobile] = useState(false);

  const containerRef = useRef(null);
  const iframeRef = useRef(null);
  const modalRef = useRef(null);
  const activeBlobRef = useRef(null);
  const touchStartXRef = useRef(null);

  // Lock body scroll while modal is active
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Viewport & Mobile Detection
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setIsFitWidth(true);
        setViewMode('canvas'); // Mobile browsers do not support iframe PDF plugins
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Measure Container Width with ResizeObserver for Fluid Responsive Scaling
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width > 0) {
          setContainerWidth(width);
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [viewMode, isFullscreen]);

  const [resumeNotice, setResumeNotice] = useState(null);
  const lastSavedPageRef = useRef(1);
  const saveDebounceTimerRef = useRef(null);

  // Debounced Cross-Device Progress Persistence (3s debounce)
  const persistProgress = useCallback((targetPage, total) => {
    if (!item?.id || !targetPage || targetPage === lastSavedPageRef.current) return;
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
    }
    saveDebounceTimerRef.current = setTimeout(() => {
      lastSavedPageRef.current = targetPage;
      fetch(`/api/library/items/${item.id}/progress`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: targetPage, totalPages: total || numPages }),
        keepalive: true,
      }).catch(() => {});
    }, 3000);
  }, [item?.id, numPages]);

  // Track latest reading state synchronously in render body (guarantees zero-lag between state transition and unmount flush)
  const progressStateRef = useRef({ itemId: item?.id, currentPage, numPages });
  progressStateRef.current = { itemId: item?.id, currentPage, numPages };

  // Synchronous flush helper for mobile lifecycle and modal teardown
  const flushProgress = useCallback(() => {
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = null;
    }
    const { itemId, currentPage: page, numPages: total } = progressStateRef.current;
    if (itemId && page && page !== lastSavedPageRef.current) {
      lastSavedPageRef.current = page;
      fetch(`/api/library/items/${itemId}/progress`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, totalPages: total }),
        keepalive: true,
      }).catch(() => {});
    }
  }, []); // Stable identity: zero dependencies!

  // W3C Page Lifecycle API: Android Chrome & iOS Safari tab suspension / app switch
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress();
      }
    };
    const handlePageHide = () => {
      flushProgress();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      flushProgress(); // Only executes when PDFViewerModal actually UNMOUNTS!
    };
  }, [flushProgress]);

  // Page Navigation State Helper with Auto-Save
  const navigateToPage = useCallback((targetPage) => {
    setCurrentPage((prev) => {
      const validMax = numPages || 1;
      const next = Math.max(1, Math.min(validMax, typeof targetPage === 'function' ? targetPage(prev) : targetPage));
      setPageInput(String(next));
      persistProgress(next, numPages);
      return next;
    });
  }, [numPages, persistProgress]);

  // Keyboard navigation & Shortcuts Handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes(e.target?.tagName);
      if (isInput) {
        if (e.key === 'Escape') {
          e.target.blur();
        }
        return;
      }

      // 1. Navigation Shortcuts
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        navigateToPage((p) => p + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        navigateToPage((p) => p - 1);
      } else if (e.key === ']' || (e.shiftKey && e.key === 'ArrowRight')) {
        e.preventDefault();
        navigateToPage((p) => p + 10);
      } else if (e.key === '[' || (e.shiftKey && e.key === 'ArrowLeft')) {
        e.preventDefault();
        navigateToPage((p) => p - 10);
      } else if (e.key === 'Home') {
        e.preventDefault();
        navigateToPage(1);
      } else if (e.key === 'End' && numPages) {
        e.preventDefault();
        navigateToPage(numPages);
      }

      // 2. Zoom & View Controls
      else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setIsFitWidth(false);
        setScale((s) => Math.min(2.5, +(s + 0.15).toFixed(2)));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setIsFitWidth(false);
        setScale((s) => Math.max(0.5, +(s - 0.15).toFixed(2)));
      } else if (e.key === '0' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        setIsFitWidth(true);
        setScale(1.0);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setIsFullscreen((prev) => !prev);
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setViewMode((m) => (m === 'canvas' ? 'iframe' : 'canvas'));
      }

      // 3. Modal / Dialog Controls
      else if (e.key === 'Escape') {
        e.preventDefault();
        if (showShortcutsModal) {
          setShowShortcutsModal(false);
        } else {
          onClose();
        }
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [numPages, onClose, showShortcutsModal, navigateToPage]);

  // Authenticated Stream & Edge Capability Ticket Pipeline (Phase 13D)
  const loadDocumentBlob = useCallback(async (signal) => {
    if (!item?.id) return;
    setIsLoading(true);
    setLoadError(null);

    try {
      const nonce = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('session_nonce') : '';
      
      // Step 1: Acquire Ephemeral Capability Lease Ticket & Authoritative Reading Position in 1 RTT (Invariant 6)
      let streamUrl = `/api/library/items/${item.id}/stream`;
      try {
        const ticketRes = await fetch(`/api/library/items/${item.id}/ticket`, {
          signal,
          credentials: 'include',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            ...(nonce ? { 'X-Session-Nonce': nonce } : {})
          }
        });
        if (ticketRes.ok) {
          const ticketData = await ticketRes.json();
          if (ticketData?.streamUrl) {
            streamUrl = ticketData.streamUrl;
          }
          if (ticketData?.readingProgress?.hasProgress && ticketData.readingProgress.lastPage > 1) {
            const resumePage = ticketData.readingProgress.lastPage;
            setCurrentPage(resumePage);
            setPageInput(String(resumePage));
            lastSavedPageRef.current = resumePage;
            setResumeNotice(`Resumed at page ${resumePage}${ticketData.readingProgress.percentage ? ` (${ticketData.readingProgress.percentage}% read)` : ''}`);
            setTimeout(() => {
              setResumeNotice(null);
            }, 6000);
          }
        }
      } catch {
        // Graceful fallback to direct stream URL
      }

      // Step 2: Fetch Document Stream using capability ticket
      const response = await fetch(streamUrl, {
        signal,
        credentials: 'include',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          ...(nonce ? { 'X-Session-Nonce': nonce } : {})
        }
      });

      if (!response.ok) {
        let errMessage = `HTTP ${response.status}: Failed to load document`;
        try {
          const errJson = await response.json();
          if (errJson.detail) errMessage = errJson.detail;
          else if (errJson.error) errMessage = errJson.error;
        } catch {
          // Fallback to HTTP status text
        }
        throw new Error(errMessage);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      if (activeBlobRef.current) {
        URL.revokeObjectURL(activeBlobRef.current);
      }
      activeBlobRef.current = objectUrl;
      setBlobUrl(objectUrl);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setLoadError(err.message || 'Unable to stream academic document');
      }
    } finally {
      setIsLoading(false);
    }
  }, [item?.id]);

  useEffect(() => {
    const ac = new AbortController();
    loadDocumentBlob(ac.signal);

    // Sliding-Window Edge Capability Ticket Renewal (10-minute heartbeat)
    const renewalInterval = setInterval(async () => {
      if (!item?.id) return;
      try {
        await fetch(`/api/library/items/${item.id}/ticket`, { credentials: 'include' });
      } catch {
        // Ignore background renewal errors
      }
    }, 10 * 60 * 1000);

    const activeIframe = iframeRef.current;
    return () => {
      ac.abort();
      clearInterval(renewalInterval);
      if (activeBlobRef.current) {
        URL.revokeObjectURL(activeBlobRef.current);
        activeBlobRef.current = null;
      }
      if (activeIframe) {
        activeIframe.src = 'about:blank';
      }
    };
  }, [loadDocumentBlob, item?.id]);

  if (!item) return null;

  const handleDownloadClick = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      await onDownload(item);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpenInNewTab = () => {
    if (blobUrl) {
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const onDocumentLoadSuccess = ({ numPages: loadedNumPages }) => {
    setNumPages(loadedNumPages);
    setCurrentPage(1);
    setPageInput('1');
  };

  const handlePageInputChange = (e) => {
    setPageInput(e.target.value);
  };

  const handlePageInputSubmit = (e) => {
    e.preventDefault();
    const parsed = parseInt(pageInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= (numPages || 1)) {
      navigateToPage(parsed);
    } else {
      setPageInput(String(currentPage));
    }
  };

  // Touch Swipe Handlers for Mobile (Kindle / E-Reader feel)
  const handleTouchStart = (e) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    if (touchStartXRef.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diffX = touchEndX - touchStartXRef.current;
    
    if (diffX < -50 && currentPage < (numPages || 1)) {
      navigateToPage((p) => p + 1);
    } else if (diffX > 50 && currentPage > 1) {
      navigateToPage((p) => p - 1);
    }
    touchStartXRef.current = null;
  };

  // Compute Page Render Width:
  const effectivePageWidth = isFitWidth 
    ? Math.max(280, isMobile ? containerWidth - 16 : Math.min(containerWidth - 48, 1000))
    : Math.max(280, (isMobile ? containerWidth - 16 : 800) * scale);

  const formattedSize = formatFileSize(item.file_size_bytes);
  const isDirectFullscreen = isFullscreen || isMobile;

  const modalElement = (
    <div 
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/85 backdrop-blur-md overflow-hidden animate-in fade-in duration-200 ${
        isDirectFullscreen ? 'p-0' : 'p-3 sm:p-5 lg:p-7'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-viewer-title"
    >
      <div 
        ref={modalRef}
        className={`flex flex-col w-full bg-slate-950 text-slate-100 shadow-2xl overflow-hidden transition-all duration-200 ${
          isDirectFullscreen
            ? 'w-screen h-[100dvh] max-h-[100dvh] rounded-none border-0'
            : 'max-w-6xl h-full max-h-[86vh] sm:max-h-[88vh] border border-slate-800 rounded-2xl sm:rounded-3xl'
        }`}
      >
        {/* 1. Modal Header (shrink-0) */}
        <div className="flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3.5 border-b border-slate-800 bg-slate-900/95 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3.5 overflow-hidden mr-2">
            <div className="p-1.5 sm:p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
              <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="truncate">
              <h2 id="pdf-viewer-title" className="text-xs sm:text-base font-bold text-white truncate">
                {item.title}
              </h2>
              <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-[11px] sm:text-xs text-slate-400 mt-0.5">
                {item.course_id && (
                  <span className="font-semibold text-indigo-300">
                    {item.course_id}
                  </span>
                )}
                {item.author && (
                  <span className="truncate max-w-[140px] sm:max-w-[280px]">
                    • {item.author}
                  </span>
                )}
                {numPages && (
                  <span className="hidden xs:inline-block font-mono text-[10px] sm:text-[11px] text-slate-400 bg-slate-800/90 px-1.5 py-0.5 rounded">
                    {numPages} pages
                  </span>
                )}
                {formattedSize && (
                  <span className="hidden sm:inline-block font-mono text-[11px] text-slate-500">
                    • {formattedSize}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Header Controls */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* View Mode Toggle (Reader vs Desktop Plugin) */}
            {blobUrl && (
              <div className="flex items-center bg-slate-800/90 p-0.5 rounded-xl border border-slate-700/60 mr-1 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode('canvas')}
                  className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer text-xs ${
                    viewMode === 'canvas' 
                      ? 'bg-indigo-600 text-white shadow-sm font-semibold' 
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Canvas Reader (Mobile & Desktop fluid view) [M]"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline">Reader</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('iframe')}
                  className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer text-xs ${
                    viewMode === 'iframe' 
                      ? 'bg-indigo-600 text-white shadow-sm font-semibold' 
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Desktop Browser Plugin (Chrome native viewer) [M]"
                >
                  <Monitor className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline">Desktop Plugin</span>
                </button>
              </div>
            )}

            {/* Shortcuts Help Button */}
            <button
              type="button"
              onClick={() => setShowShortcutsModal(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-colors cursor-pointer"
              title="Keyboard Shortcuts (?)"
              aria-label="Keyboard Shortcuts"
            >
              <Keyboard className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Shortcuts</span>
              <kbd className="hidden md:inline-block font-mono text-[10px] text-slate-400 bg-slate-900 px-1 py-0.2 rounded border border-slate-700 font-semibold">?</kbd>
            </button>

            {/* Open in New Tab */}
            {blobUrl && (
              <button
                type="button"
                onClick={handleOpenInNewTab}
                className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60 transition-colors cursor-pointer"
                title="Open directly in new browser tab"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>New Tab</span>
              </button>
            )}

            {/* Download Button */}
            <button
              type="button"
              onClick={handleDownloadClick}
              disabled={isDownloading}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-all disabled:opacity-50 shadow-sm cursor-pointer"
              aria-label="Download Document"
            >
              {isDownloading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">Download</span>
            </button>

            {/* Fullscreen / Minimize Toggle (Desktop) */}
            {!isMobile && (
              <button
                type="button"
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="p-1.5 sm:p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label={isFullscreen ? 'Minimize to Window' : 'Expand to Fullscreen'}
                title={isFullscreen ? 'Minimize to Window [F]' : 'Expand to Fullscreen [F]'}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            )}

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 sm:p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer min-w-[36px] min-h-[36px] flex items-center justify-center"
              aria-label="Close PDF Viewer"
              title="Close [Esc]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 2. Document Body Viewport (flex-1 min-h-0 overflow-hidden) */}
        <div 
          ref={containerRef}
          className="relative flex-1 min-h-0 w-full bg-slate-950 flex flex-col items-center justify-start overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Cross-Device Reading Position Resumption Pill */}
          {resumeNotice && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 bg-indigo-600/95 text-white text-xs font-semibold rounded-full shadow-xl backdrop-blur-md flex items-center gap-2 border border-indigo-400/40 pointer-events-none">
              <BookOpen className="w-3.5 h-3.5 text-indigo-200" />
              <span>{resumeNotice}</span>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 bg-slate-950/95 backdrop-blur-sm text-center">
              <div className="relative mb-4">
                <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <FileText className="w-7 h-7 animate-pulse" />
                </div>
                <div className="absolute -bottom-1 -right-1 p-1 bg-indigo-600 rounded-full text-white">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                </div>
              </div>
              <h3 className="text-sm sm:text-base font-semibold text-white mb-1">
                Streaming & Preparing Document...
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mb-2">
                Buffering high-resolution PDF pages for mobile and desktop reading.
              </p>
              {formattedSize && (
                <span className="text-[11px] font-mono text-indigo-400 bg-indigo-950/60 px-3 py-1 rounded-full border border-indigo-800/40">
                  {formattedSize}
                </span>
              )}
            </div>
          )}

          {/* Error State */}
          {loadError && !isLoading && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 bg-slate-950 text-center max-w-md mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mb-4">
                <AlertCircle className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold text-white mb-1">
                Unable to Display Document
              </h3>
              <p className="text-xs text-slate-400 mb-5 leading-relaxed">
                {loadError}
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => loadDocumentBlob()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-white transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Stream</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadClick}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Direct Download</span>
                </button>
              </div>
            </div>
          )}

          {/* Engine A: React-PDF Canvas Reader (Mobile & Desktop Responsive) */}
          {blobUrl && !loadError && viewMode === 'canvas' && (
            <div className="w-full h-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col items-center py-3 sm:py-6 px-1.5 sm:px-4">
              <Document
                file={blobUrl}
                onLoadSuccess={onDocumentLoadSuccess}
                loading={
                  <div className="flex flex-col items-center justify-center py-20 text-indigo-400">
                    <Loader2 className="w-8 h-8 animate-spin mb-3 text-indigo-500" />
                    <p className="text-xs text-slate-400">Rendering document pages...</p>
                  </div>
                }
                error={
                  <div className="flex flex-col items-center justify-center py-16 text-center max-w-sm">
                    <AlertCircle className="w-10 h-10 text-amber-400 mb-3" />
                    <p className="text-sm text-slate-300 font-semibold mb-1">Canvas Render Issue</p>
                    <p className="text-xs text-slate-400 mb-4">
                      Unable to parse embedded fonts in this specific browser. You can switch to the browser plugin or open in a new tab.
                    </p>
                    <button
                      type="button"
                      onClick={() => setViewMode('iframe')}
                      className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-white"
                    >
                      Switch to Browser Plugin
                    </button>
                  </div>
                }
              >
                <div className="relative shadow-2xl rounded-sm overflow-hidden bg-white max-w-full">
                  <Page
                    pageNumber={currentPage}
                    width={effectivePageWidth}
                    renderTextLayer={!isMobile}
                    renderAnnotationLayer={!isMobile}
                    className="max-w-full"
                    loading={
                      <div 
                        style={{ width: effectivePageWidth, height: effectivePageWidth * 1.3 }} 
                        className="bg-slate-800 animate-pulse flex flex-col items-center justify-center text-slate-400"
                      >
                        <Loader2 className="w-6 h-6 animate-spin mb-2 text-indigo-400" />
                        <span className="text-xs">Page {currentPage}...</span>
                      </div>
                    }
                  />
                </div>
              </Document>
            </div>
          )}

          {/* Engine B: Native Iframe Plugin (Desktop Power-User) */}
          {blobUrl && !loadError && viewMode === 'iframe' && (
            <div className="w-full h-full flex-1 min-h-0 overflow-hidden bg-slate-900">
              <iframe
                ref={iframeRef}
                src={`${blobUrl}#toolbar=1&navpanes=0`}
                title={item.title}
                className="w-full h-full border-0 block"
                allow="fullscreen"
              />
            </div>
          )}
        </div>

        {/* 3. Bottom Navigation Bar (Canvas Reader Mode only, shrink-0) */}
        {blobUrl && !loadError && viewMode === 'canvas' && numPages && (
          <div className="flex items-center justify-between px-3 sm:px-6 py-2 sm:py-2.5 border-t border-slate-800 bg-slate-900/95 backdrop-blur-md shrink-0 text-xs text-slate-300">
            {/* Page Jump / Fast Navigation */}
            <div className="flex items-center gap-1 sm:gap-1.5">
              {/* Jump -10 (Desktop) */}
              <button
                type="button"
                onClick={() => navigateToPage((p) => p - 10)}
                disabled={currentPage <= 1}
                className="hidden sm:inline-flex items-center p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
                title="Jump -10 pages [Press '[']"
              >
                <ChevronsLeft className="w-4 h-4" />
                <span className="text-[10px] text-slate-500 font-mono hidden xl:inline ml-0.5">-10</span>
              </button>

              {/* Prev Page Button */}
              <button
                type="button"
                onClick={() => navigateToPage((p) => p - 1)}
                disabled={currentPage <= 1}
                className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold disabled:opacity-30 disabled:hover:bg-slate-800 transition-colors cursor-pointer shadow-sm"
                aria-label="Previous Page"
                title="Previous Page [Press '←' or 'K']"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden xs:inline">Prev</span>
                <kbd className="hidden md:inline-block font-mono text-[9px] text-slate-400 bg-slate-900 px-1 py-0.2 rounded border border-slate-700">←</kbd>
              </button>

              {/* Page Number Form */}
              <form onSubmit={handlePageInputSubmit} className="flex items-center gap-1.5 mx-1">
                <span className="text-slate-400 text-[11px] sm:text-xs">Page</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={pageInput}
                  onChange={handlePageInputChange}
                  onBlur={handlePageInputSubmit}
                  className="w-12 sm:w-14 text-center py-1 px-1.5 rounded-lg bg-slate-950 border border-slate-700 font-mono text-xs text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  aria-label="Current Page Number"
                />
                <span className="text-slate-400 text-[11px] sm:text-xs">
                  of {numPages}
                </span>
              </form>

              {/* Next Page Button */}
              <button
                type="button"
                onClick={() => navigateToPage((p) => p + 1)}
                disabled={currentPage >= numPages}
                className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold disabled:opacity-30 disabled:hover:bg-slate-800 transition-colors cursor-pointer shadow-sm"
                aria-label="Next Page"
                title="Next Page [Press '→' or 'J']"
              >
                <span className="hidden xs:inline">Next</span>
                <kbd className="hidden md:inline-block font-mono text-[9px] text-slate-400 bg-slate-900 px-1 py-0.2 rounded border border-slate-700">→</kbd>
                <ChevronRight className="w-4 h-4" />
              </button>

              {/* Jump +10 (Desktop) */}
              <button
                type="button"
                onClick={() => navigateToPage((p) => p + 10)}
                disabled={currentPage >= numPages}
                className="hidden sm:inline-flex items-center p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
                title="Jump +10 pages [Press ']']"
              >
                <span className="text-[10px] text-slate-500 font-mono hidden xl:inline mr-0.5">+10</span>
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>

            {/* In-Line Written Shortcuts Legend (Explicitly displayed in UI) */}
            <div className="hidden lg:flex items-center gap-2.5 px-3 py-1 bg-slate-950/80 rounded-xl border border-slate-800 text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-mono text-[10px] border border-slate-700 shadow-sm font-semibold">←</kbd>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-mono text-[10px] border border-slate-700 shadow-sm font-semibold">→</kbd>
                <span className="text-slate-400 text-[10px] ml-0.5">Pages</span>
              </span>
              <span className="text-slate-700">•</span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-mono text-[10px] border border-slate-700 shadow-sm font-semibold">[</kbd>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-mono text-[10px] border border-slate-700 shadow-sm font-semibold">]</kbd>
                <span className="text-slate-400 text-[10px] ml-0.5">±10</span>
              </span>
              <span className="text-slate-700">•</span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-mono text-[10px] border border-slate-700 shadow-sm font-semibold">+</kbd>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-mono text-[10px] border border-slate-700 shadow-sm font-semibold">-</kbd>
                <span className="text-slate-400 text-[10px] ml-0.5">Zoom</span>
              </span>
              <span className="text-slate-700">•</span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-mono text-[10px] border border-slate-700 shadow-sm font-semibold">W</kbd>
                <span className="text-slate-400 text-[10px] ml-0.5">Fit</span>
              </span>
              <span className="text-slate-700">•</span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-mono text-[10px] border border-slate-700 shadow-sm font-semibold">F</kbd>
                <span className="text-slate-400 text-[10px] ml-0.5">Full</span>
              </span>
            </div>

            {/* Zoom / Scaling Controls */}
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsFitWidth(true);
                  setScale(1.0);
                }}
                className={`px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                  isFitWidth
                    ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
                title="Fit to Page Width [Press 'W' or '0']"
              >
                <span>Fit Width</span>
                <kbd className="hidden sm:inline-block font-mono text-[9px] text-slate-400 bg-slate-900 px-1 py-0.2 rounded border border-slate-700">W</kbd>
              </button>

              <div className="hidden xs:flex items-center bg-slate-800/80 rounded-lg p-0.5 border border-slate-700/60">
                <button
                  type="button"
                  onClick={() => {
                    setIsFitWidth(false);
                    setScale((s) => Math.max(0.5, +(s - 0.15).toFixed(2)));
                  }}
                  className="p-1 hover:text-white text-slate-400 transition-colors cursor-pointer"
                  title="Zoom Out [Press '-']"
                  aria-label="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="px-1.5 font-mono text-[11px] text-slate-300 min-w-[42px] text-center">
                  {isFitWidth ? 'Auto' : `${Math.round(scale * 100)}%`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIsFitWidth(false);
                    setScale((s) => Math.min(2.5, +(s + 0.15).toFixed(2)));
                  }}
                  className="p-1 hover:text-white text-slate-400 transition-colors cursor-pointer"
                  title="Zoom In [Press '+']"
                  aria-label="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. Interactive Keyboard Shortcuts Cheat-Sheet Modal */}
      {showShortcutsModal && (
        <div 
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcuts-dialog-title"
          onClick={() => setShowShortcutsModal(false)}
        >
          <div 
            className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5 text-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2 text-white">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  <Keyboard className="w-4 h-4" />
                </div>
                <h3 id="shortcuts-dialog-title" className="font-bold text-sm sm:text-base">
                  Keyboard Shortcuts Guide
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowShortcutsModal(false)}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                aria-label="Close shortcuts guide"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Category 1: Navigation */}
              <div>
                <h4 className="font-semibold text-indigo-400 uppercase tracking-wider text-[10px] mb-2">
                  Page Navigation
                </h4>
                <div className="grid grid-cols-2 gap-2 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                  <div className="flex items-center justify-between pr-2">
                    <span className="text-slate-300">Next Page</span>
                    <div className="flex gap-1 font-mono">
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">→</kbd>
                      <span className="text-slate-500">or</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">J</kbd>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pl-2 border-l border-slate-800">
                    <span className="text-slate-300">Previous Page</span>
                    <div className="flex gap-1 font-mono">
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">←</kbd>
                      <span className="text-slate-500">or</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">K</kbd>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pr-2 pt-2 border-t border-slate-800/80">
                    <span className="text-slate-300">Jump +10 Pages</span>
                    <div className="flex gap-1 font-mono">
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">]</kbd>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pl-2 pt-2 border-t border-l border-slate-800">
                    <span className="text-slate-300">Jump -10 Pages</span>
                    <div className="flex gap-1 font-mono">
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">[</kbd>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pr-2 pt-2 border-t border-slate-800/80">
                    <span className="text-slate-300">First Page</span>
                    <div className="flex gap-1 font-mono">
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">Home</kbd>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pl-2 pt-2 border-t border-l border-slate-800">
                    <span className="text-slate-300">Last Page</span>
                    <div className="flex gap-1 font-mono">
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">End</kbd>
                    </div>
                  </div>
                </div>
              </div>

              {/* Category 2: Zoom & Viewport */}
              <div>
                <h4 className="font-semibold text-indigo-400 uppercase tracking-wider text-[10px] mb-2">
                  Zoom & Display
                </h4>
                <div className="grid grid-cols-2 gap-2 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                  <div className="flex items-center justify-between pr-2">
                    <span className="text-slate-300">Zoom In / Out</span>
                    <div className="flex gap-1 font-mono">
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">+</kbd>
                      <span className="text-slate-500">/</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">-</kbd>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pl-2 border-l border-slate-800">
                    <span className="text-slate-300">Fit Page Width</span>
                    <div className="flex gap-1 font-mono">
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">W</kbd>
                      <span className="text-slate-500">or</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">0</kbd>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pr-2 pt-2 border-t border-slate-800/80">
                    <span className="text-slate-300">Toggle Fullscreen</span>
                    <div className="flex gap-1 font-mono">
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">F</kbd>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pl-2 pt-2 border-t border-l border-slate-800">
                    <span className="text-slate-300">Reader / Plugin Mode</span>
                    <div className="flex gap-1 font-mono">
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">M</kbd>
                    </div>
                  </div>
                </div>
              </div>

              {/* Category 3: General */}
              <div>
                <h4 className="font-semibold text-indigo-400 uppercase tracking-wider text-[10px] mb-2">
                  General
                </h4>
                <div className="grid grid-cols-2 gap-2 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                  <div className="flex items-center justify-between pr-2">
                    <span className="text-slate-300">Shortcuts Guide</span>
                    <div className="flex gap-1 font-mono">
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">?</kbd>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pl-2 border-l border-slate-800">
                    <span className="text-slate-300">Close Viewer</span>
                    <div className="flex gap-1 font-mono">
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] border border-slate-700">Esc</kbd>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowShortcutsModal(false)}
                className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalElement, document.body) : modalElement;
}

export default PDFViewerModal;
