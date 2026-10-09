export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="icon"></div>
        <span>FOCIT LMS</span>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <a href="#" style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', background: 'var(--primary-50)', color: 'var(--primary-700)', fontWeight: 600, textDecoration: 'none' }}>
          My Courses
        </a>
        <a href="#" style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', color: 'var(--surface-500)', textDecoration: 'none' }}>
          Assignments
        </a>
        <a href="#" style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', color: 'var(--surface-500)', textDecoration: 'none' }}>
          Grades
        </a>
      </nav>
    </aside>
  );
}
