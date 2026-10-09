import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { FileText, Search, Download, Eye } from 'lucide-react';
import { PDFViewer } from '../components/PDFViewer';
import { useMaterials } from '../hooks/useMaterials';

export const MaterialsPage = () => {
  const { courseId } = useParams();
  
  // 1. URL State (Source of Truth for sharing/refreshing)
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSearchQuery = searchParams.get('search') || '';
  
  // 2. Local State (For instant 60fps typing without router thrashing)
  const [localSearch, setLocalSearch] = useState(urlSearchQuery);

  const [activePdfId, setActivePdfId] = useState(null);
  const [activeBuffer, setActiveBuffer] = useState(null);

  // 3. Debounce Flush: Sync local state to URL after 300ms of inactivity
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (localSearch) {
        params.set('search', localSearch);
      } else {
        params.delete('search');
      }
      setSearchParams(params, { replace: true });
    }, 300);
    
    return () => clearTimeout(timer);
  }, [localSearch, searchParams, setSearchParams]);

  // Consuming the data pipeline using the URL state as the contract
  const { 
    data: materials, 
    isPending, 
    isFetching,
    error,
    fetchPdfBinary,
    isPdfLoading
  } = useMaterials({ courseId, search: urlSearchQuery });
  
  const handleViewPdf = async (materialId) => {
    setActivePdfId(materialId);
    const arrayBuffer = await fetchPdfBinary(materialId);
    if (arrayBuffer) {
      setActiveBuffer(arrayBuffer);
    } else {
      setActivePdfId(null);
      setActiveBuffer(null);
    }
  };

  const closeViewer = () => {
    setActivePdfId(null);
    setActiveBuffer(null); // Explicit GC trigger
  };

  if (error) {
    throw new Error('Failed to synchronize course materials from the FOCIT secure proxy.');
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col h-full relative">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[#0a1142]">Course Materials</h1>
          <p className="text-gray-500 mt-1">Securely streamed via FOCIT LMS</p>
        </div>
        
        <div className="relative max-w-md w-full">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search size={18} className="text-gray-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-[#ffb81c] focus:border-[#ffb81c] transition-colors"
            placeholder="Search lectures, slides..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            aria-label="Search course materials"
          />
        </div>
      </div>

      {/* Concurrent Rendering Feedback Matrix */}
      <div className="flex-1 transition-opacity duration-200">
        
        {(isPending || isFetching) && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" aria-label="Loading materials">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm flex flex-col items-start gap-4">
                <div className="w-12 h-12 bg-gray-200 rounded-lg animate-pulse" />
                <div className="w-3/4 h-5 bg-gray-200 rounded animate-pulse" />
                <div className="w-1/2 h-4 bg-gray-100 rounded animate-pulse mb-4" />
                <div className="flex gap-2 w-full mt-auto">
                  <div className="h-10 bg-gray-100 rounded flex-1 animate-pulse" />
                  <div className="h-10 bg-gray-100 rounded w-12 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!(isPending || isFetching) && materials?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-6 text-gray-400">
              <FileText size={32} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">No materials found</h3>
            <p className="text-gray-500 max-w-sm">
              {urlSearchQuery 
                ? `No documents matched your search "${urlSearchQuery}".` 
                : "Your instructor has not published any materials for this module yet."}
            </p>
          </div>
        )}

        {!(isPending || isFetching) && materials?.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {materials.map((material) => (
              <article key={material.id} className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow group flex flex-col">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 bg-[#0a1142]/5 rounded-lg text-[#0a1142]">
                    <FileText size={24} />
                  </div>
                  <span className="text-xs font-semibold px-2 py-1 bg-gray-100 text-gray-600 rounded-full">
                    {material.type.toUpperCase()}
                  </span>
                </div>
                
                <h3 className="font-bold text-gray-900 text-lg mb-1 line-clamp-2" title={material.title}>
                  {material.title}
                </h3>
                <p className="text-sm text-gray-500 mb-6">
                  Added {new Date(material.createdAt).toLocaleDateString()}
                </p>

                <div className="mt-auto flex gap-3">
                  <button
                    onClick={() => handleViewPdf(material.id)}
                    disabled={isPdfLoading && activePdfId === material.id}
                    className="flex-1 flex items-center justify-center gap-2 bg-[#0a1142] hover:bg-[#0a1142]/90 text-white px-4 py-2 rounded-lg font-medium transition-colors focus:ring-2 focus:ring-[#ffb81c] focus:outline-none disabled:opacity-70"
                    aria-label={`View ${material.title}`}
                  >
                    {isPdfLoading && activePdfId === material.id ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <Eye size={18} />
                        View Document
                      </>
                    )}
                  </button>
                  <button
                    className="p-2 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-600 rounded-lg transition-colors focus:ring-2 focus:ring-gray-300 focus:outline-none"
                    aria-label={`Download ${material.title}`}
                    title="Encrypted Download"
                  >
                    <Download size={18} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {activePdfId && activeBuffer && (
        <PDFViewer 
          arrayBuffer={activeBuffer} 
          title={materials?.find(m => m.id === activePdfId)?.title}
          onClose={closeViewer} 
        />
      )}
    </div>
  );
};
