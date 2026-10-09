import { memo } from 'react';
import MaterialCard from './MaterialCard';

const CourseSection = memo(function CourseSection({ section }) {
  return (
    <div style={{ marginBottom: '2.5rem' }}>
      <h3 className="text-h3" style={{ marginBottom: '1rem', color: 'var(--surface-900)' }}>
        {section.title}
      </h3>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: '1rem'
      }}>
        {section.materials.map(material => (
          <MaterialCard key={material.id} material={material} />
        ))}
      </div>
    </div>
  );
});

export default CourseSection;
