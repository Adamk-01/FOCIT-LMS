export default function PDFViewerModal({ material, onClose }) {
  if (!material) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(15, 23, 42, 0.7)',
        backdropFilter: 'blur(4px)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div style={{
        padding: '1rem 2rem',
        backgroundColor: 'var(--surface-900)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h2 className="text-h3" style={{ color: 'white', margin: 0 }}>
            {material.name}
          </h2>
          <span className="text-muted" style={{ color: 'var(--surface-400)' }}>
            {(material.sizeBytes / 1024 / 1024).toFixed(1)} MB
          </span>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <a 
            href={material.url} 
            download={material.name}
            className="btn btn-primary"
          >
            Download
          </a>
          <button 
            className="btn btn-outline" 
            style={{ color: 'white', borderColor: 'rgba(255,255,255,0.2)' }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
      
      <div style={{ flex: 1, backgroundColor: 'var(--surface-200)' }}>
        {/* Phase 2: PDF.js streaming implementation goes here */}
        <iframe 
          src={material.url} 
          width="100%" 
          height="100%" 
          style={{ border: 'none' }}
          title={material.name}
        />
      </div>
    </div>
  );
}
