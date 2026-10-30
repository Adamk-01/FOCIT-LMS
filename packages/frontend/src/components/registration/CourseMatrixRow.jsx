import React from 'react';

/**
 * <CourseMatrixRow />
 * Renders an accessible selectable course row with level and carryover badges.
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function CourseMatrixRow({ course, isSelected, toggleCourse, studentLevel }) {
  const maxCapacity = course.max_capacity ?? 0;
  const isFull = maxCapacity <= 0 || (course.enrolled_count || 0) >= maxCapacity;
  const isCarryover = course.is_carryover || (studentLevel && course.level < studentLevel);

  return (
    <tr
      onClick={() => !isFull && toggleCourse(course.course_id)}
      className={`cursor-pointer transition-colors ${
        isSelected ? 'bg-[#0a1142]/5 font-medium' : 'hover:bg-gray-50/80'
      } ${isFull ? 'opacity-50 cursor-not-allowed bg-gray-50' : ''}`}
    >
      <td className="py-3 px-4 text-center">
        <div className="flex items-center justify-center min-h-[40px]">
          <input
            type="checkbox"
            checked={isSelected}
            disabled={isFull}
            onChange={() => toggleCourse(course.course_id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${course.code}: ${course.title}`}
            className="w-4 h-4 rounded text-[#0a1142] focus:ring-[#0a1142] border-gray-300 cursor-pointer disabled:cursor-not-allowed"
          />
        </div>
      </td>
      <td className="py-3 px-4">
        <div className="font-black font-display text-[#0a1142] flex items-center gap-1.5">
          <span>{course.code}</span>
          {isCarryover && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold">
              {course.level}L Carryover
            </span>
          )}
        </div>
      </td>
      <td className="py-3 px-4 text-gray-800 text-xs sm:text-sm">
        <div className="flex flex-col">
          <span>{course.title}</span>
          <span className="text-[11px] text-gray-400 font-normal">
            {course.department_name ? `${course.department_name} • ` : ''}{course.level} Level
          </span>
        </div>
      </td>
      <td className="py-3 px-4">
        <span
          className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
            course.category === 'CORE'
              ? 'bg-blue-100 text-blue-800'
              : course.category === 'ELECTIVE'
              ? 'bg-purple-100 text-purple-800'
              : 'bg-gray-100 text-gray-800'
          }`}
        >
          {course.category}
        </span>
      </td>
      <td className="py-3 px-4 font-bold text-gray-800 font-display">
        {course.units}
      </td>
      <td className="py-3 px-4">
        <span className={`text-xs font-semibold ${isFull ? 'text-red-600 font-bold' : 'text-gray-600'}`}>
          {course.enrolled_count || 0} / {course.max_capacity || 200}
          {isFull && ' (FULL)'}
        </span>
      </td>
    </tr>
  );
}
export default CourseMatrixRow;
