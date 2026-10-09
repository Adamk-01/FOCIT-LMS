import React, { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { useVirtualizer } from '@tanstack/react-virtual';
import { X, ZoomIn, ZoomOut, AlertCircle } from 'lucide-react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure the worker explicitly for Vite environments
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export const PDFViewer = ({ arrayBuffer, onClose, title }) => {
  const [numPages, setNumPages] = useState(null);
  const [scale, setScale] = useState(1.0);
  const [isMobile, setIsMobile] = useState(false);
  const parentRef = useRef(null);

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

  return (
    <div className="fixed inset-0 z-[9000] flex flex-col bg-[#0a1142] text-white">
      {/* Security/UI Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-black/40 border-b border-white/10 shadow-lg">
        <h2 className="font-semibold text-lg truncate flex-1">{title || 'Secure Document Viewer'}</h2>
        
        <div className="flex items-center space-x-4">
          <div className="flex items-center bg-black/30 rounded-lg p-1">
            <button 
              onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
              className="p-2 hover:bg-white/10 rounded transition-colors focus:ring-2 focus:ring-[#ffb81c] focus:outline-none"
              aria-label="Zoom out"
            >
              <ZoomOut size={18} />
            </button>
            <span className="px-3 text-sm font-medium w-16 text-center">
              {Math.round(scale * 100)}%
            </span>
            <button 
              onClick={() => setScale(s => Math.min(3, s + 0.25))}
              className="p-2 hover:bg-white/10 rounded transition-colors focus:ring-2 focus:ring-[#ffb81c] focus:outline-none"
              aria-label="Zoom in"
            >
              <ZoomIn size={18} />
            </button>
          </div>
          
          <button 
            onClick={onClose}
            className="p-2 hover:bg-red-500/20 text-red-200 hover:text-red-400 rounded transition-colors focus:ring-2 focus:ring-red-400 focus:outline-none"
            aria-label="Close document"
          >
            <X size={24} />
          </button>
        </div>
      </div>

      {/* Virtualized Document Container */}
      <div 
        ref={parentRef} 
        className="flex-1 overflow-auto bg-gray-900 relative"
      >
        {!arrayBuffer ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <div className="w-12 h-12 border-4 border-[#ffb81c] border-t-transparent rounded-full animate-spin mb-4" />
            <p>Decoding secure stream...</p>
          </div>
        ) : (
          <Document
            file={{ data: arrayBuffer }}
            onLoadSuccess={onDocumentLoadSuccess}
            className="flex flex-col items-center py-8"
            loading={
              <div className="flex flex-col items-center justify-center py-20 text-[#ffb81c]">
                <div className="w-8 h-8 border-4 border-current border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-gray-400">Parsing ArrayBuffer...</p>
              </div>
            }
            error={
              <div className="flex flex-col items-center justify-center py-20 text-red-400">
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
                    className="absolute top-0 left-0 w-full flex justify-center mb-6 shadow-2xl"
                    style={{
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <Page
                      pageNumber={virtualItem.index + 1}
                      scale={scale}
                      renderTextLayer={!isMobile} // Performance Defense
                      renderAnnotationLayer={!isMobile} // Performance Defense
                      className="bg-white rounded-sm overflow-hidden"
                      loading={
                        <div className="w-full h-96 bg-gray-800 animate-pulse flex items-center justify-center">
                          <span className="text-gray-500">Rendering Page {virtualItem.index + 1}</span>
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
};
