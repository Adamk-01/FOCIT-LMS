export default function ErrorState({ error }) {
  return (
    <div className="error-state glass-panel">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <h3 className="text-h3" style={{ marginBottom: '0.5rem' }}>Oops! Connection Failed</h3>
      <p className="text-body" style={{ marginBottom: '1.5rem' }}>We couldn't load the course materials. The server might be down or you might be disconnected.</p>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>Retry Connection</button>
      <p className="text-muted" style={{ marginTop: '1rem', fontSize: '0.75rem' }}>Technical Details: {error?.message}</p>
    </div>
  );
}
