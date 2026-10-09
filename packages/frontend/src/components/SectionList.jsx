import CourseSection from './CourseSection';

export default function SectionList({ sections }) {
  if (sections.length === 0) {
    return (
      <div 
        className="glass-panel" 
        style={{ padding: '3rem', textAlign: 'center' }}
      >
        <div style={{ color: 'var(--surface-400)', marginBottom: '1rem' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </div>
        <h3 className="text-h3" style={{ marginBottom: '0.5rem' }}>No materials found</h3>
        <p className="text-body" style={{ color: 'var(--surface-500)' }}>
          Try adjusting your search query.
        </p>
      </div>
    );
  }

  return (
    <div>
      {sections.map(section => (
        <CourseSection key={section.id} section={section} />
      ))}
    </div>
  );
}
