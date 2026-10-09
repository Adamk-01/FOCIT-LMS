export default function SkeletonLoader() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '2rem' }}>
      {[1, 2, 3].map((i) => (
        <div key={i} className="glass-panel" style={{ padding: '1.5rem' }}>
          <div className="skeleton" style={{ width: '30%', height: '24px', marginBottom: '1rem' }}></div>
          <div style={{ display: 'flex', gap: '1rem' }}>
             <div className="skeleton" style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-md)' }}></div>
             <div style={{ flex: 1 }}>
               <div className="skeleton" style={{ width: '60%', height: '16px', marginBottom: '0.5rem' }}></div>
               <div className="skeleton" style={{ width: '40%', height: '14px' }}></div>
             </div>
          </div>
        </div>
      ))}
    </div>
  );
}
