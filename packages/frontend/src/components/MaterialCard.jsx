import { memo, useContext } from 'react';
import { PreviewContext } from '../pages/MaterialsPage';

function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

const MaterialCard = memo(function MaterialCard({ material }) {
  const setPreviewMaterial = useContext(PreviewContext);

  const isPDF = material.type === 'pdf';
  
  const handleClick = () => {
    if (isPDF) {
      setPreviewMaterial(material);
    } else {
      window.open(material.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div 
      className="glass-panel"
      style={{ 
        padding: '1rem', 
        display: 'flex', 
        alignItems: 'center', 
        gap: '1rem',
        cursor: 'pointer',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      }}
      onClick={handleClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'var(--shadow-glass)';
      }}
    >
      <div style={{
        width: '40px',
        height: '40px',
        borderRadius: 'var(--radius-md)',
        backgroundColor: isPDF ? 'var(--primary-50)' : 'var(--surface-100)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: isPDF ? 'var(--primary-600)' : 'var(--surface-500)',
        flexShrink: 0
      }}>
        {isPDF ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <h4 className="text-body" style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>
          {material.name}
        </h4>
        <p className="text-muted" style={{ margin: 0 }}>
          {isPDF ? formatBytes(material.sizeBytes) : 'External Link'}
        </p>
      </div>
    </div>
  );
});

export default MaterialCard;
