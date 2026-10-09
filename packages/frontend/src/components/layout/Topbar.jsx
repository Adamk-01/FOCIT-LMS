export default function Topbar() {
  return (
    <header className="topbar">
      <div className="breadcrumbs text-muted">
        Home &gt; Courses &gt; <span style={{ color: 'var(--surface-900)', fontWeight: 500 }}>Materials</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--surface-300)' }}></div>
      </div>
    </header>
  );
}
