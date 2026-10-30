import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import { useVirtualizer } from '@tanstack/react-virtual';
import { X, ZoomIn, ZoomOut, AlertCircle, ArrowUp, BookOpen } from 'lucide-react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure the worker explicitly for Vite environments
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export const PDFViewer = ({ arrayBuffer, onClose, title }) => {
  const [numPages, setNumPages] = useState(null);
  const [scale, setScale] = useState(1.0);
  const [isMobile, setIsMobile] = useState(false);
  const parentRef = useRef(null);

  // Auto-scroll scrollport to top on mount so the user never misses the viewer
  useEffect(() => {
    const mainEl = document.getElementById('main-content');
    if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Measure viewport to determine if mobile for layer toggle
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
  };

  // Virtualizer for O(1) DOM node memory complexity
  const rowVirtualizer = useVirtualizer({
    count: numPages || 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 800 * scale, // Rough estimate of page height
    overscan: 2, // Pre-render 2 pages above/below viewport
  });

  // Stabilize file prop to prevent react-pdf re-mount cycles
  const fileProp = useMemo(() => {
    if (!arrayBuffer) return null;
    return { data: arrayBuffer };
  }, [arrayBuffer]);

  const scrollToTop = () => {
    const mainEl = document.getElementById('main-content');
    if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const viewerContent = (
    <div 
      className="fixed inset-0 z-[9000] flex flex-col bg-slate-100 dark:bg-[#0a1142] text-slate-900 dark:text-white"
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Document Viewer'}
    >
      {/* Awareness Notification Banner */}
      <div className="bg-indigo-600 text-white px-4 py-1.5 text-xs flex items-center justify-between shrink-0 shadow-sm">
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="shrink-0" />
          <span>Document opened at the top of the page</span>
        </div>
        <button
          type="button"
          onClick={scrollToTop}
          className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:text-indigo-200 transition-colors cursor-pointer"
        >
          <ArrowUp size={12} />
          <span>Go to Top</span>
        </button>
      </div>

      {/* Security/UI Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 bg-white/95 dark:bg-black/40 border-b border-slate-200 dark:border-white/10 shadow-md backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3 overflow-hidden flex-1 mr-4">
          <h2 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-white truncate">
            {title || 'Secure Document Viewer'}
          </h2>
          {numPages && (
            <span className="hidden xs:inline-block text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
              {numPages} pages
            </span>
          )}
        </div>
        
        <div className="flex items-center space-x-2 sm:space-x-4 shrink-0">
          <div className="flex items-center bg-slate-100 dark:bg-black/30 rounded-lg p-0.5 sm:p-1 border border-slate-200 dark:border-white/10">
            <button 
              onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
              className="p-1.5 sm:p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:text-white dark:hover:bg-white/10 rounded transition-colors focus:ring-2 focus:ring-[#ffb81c] focus:outline-none cursor-pointer"
              aria-label="Zoom out"
            >
              <ZoomOut size={16} />
            </button>
            <span className="px-2 sm:px-3 text-xs sm:text-sm font-medium w-14 sm:w-16 text-center text-slate-800 dark:text-white font-mono">
              {Math.round(scale * 100)}%
            </span>
            <button 
              onClick={() => setScale(s => Math.min(3, s + 0.25))}
              className="p-1.5 sm:p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:text-white dark:hover:bg-white/10 rounded transition-colors focus:ring-2 focus:ring-[#ffb81c] focus:outline-none cursor-pointer"
              aria-label="Zoom in"
            >
              <ZoomIn size={16} />
            </button>
          </div>
          
          <button 
            onClick={onClose}
            className="p-1.5 sm:p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 dark:text-red-200 dark:hover:text-red-400 dark:hover:bg-red-500/20 rounded transition-colors focus:ring-2 focus:ring-red-400 focus:outline-none cursor-pointer"
            aria-label="Close document"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Virtualized Document Container */}
      <div 
        ref={parentRef} 
        className="flex-1 overflow-auto bg-slate-100 dark:bg-slate-950 relative"
      >
        {!arrayBuffer ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 dark:text-gray-400 p-6">
            <div className="w-12 h-12 border-4 border-[#ffb81c] border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-sm font-medium">Decoding secure stream...</p>
            <p className="text-xs text-slate-400 mt-1">Acquiring cryptographic lease from campus gateway.</p>
          </div>
        ) : (
          <Document
            file={fileProp}
            onLoadSuccess={onDocumentLoadSuccess}
            className="flex flex-col items-center py-8"
            loading={
              <div className="flex flex-col items-center justify-center py-20 text-[#ffb81c]">
                <div className="w-8 h-8 border-4 border-current border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-slate-500 dark:text-gray-400">Parsing ArrayBuffer...</p>
              </div>
            }
            error={
              <div className="flex flex-col items-center justify-center py-20 text-red-500 dark:text-red-400">
                <AlertCircle size={48} className="mb-4" />
                <p>Cryptographic decryption failed or stream corrupted.</p>
              </div>
            }
          >
            {numPages && (
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualItem) => (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={rowVirtualizer.measureElement}
                    className="absolute top-0 left-0 w-full flex justify-center mb-6 shadow-md"
                    style={{
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <Page
                      pageNumber={virtualItem.index + 1}
                      scale={scale}
                      renderTextLayer={!isMobile} // Performance Defense
                      renderAnnotationLayer={!isMobile} // Performance Defense
                      className="bg-white rounded-sm overflow-hidden shadow-md ring-1 ring-slate-900/10 dark:ring-white/10"
                      loading={
                        <div className="w-full h-96 bg-slate-200 dark:bg-gray-800 animate-pulse flex items-center justify-center ring-1 ring-slate-900/10 dark:ring-white/10 shadow-md">
                          <span className="text-slate-500 dark:text-gray-400">Rendering Page {virtualItem.index + 1}</span>
                        </div>
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </Document>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(viewerContent, document.body) : viewerContent;
};
