import React from 'react';
import { Filter, RotateCcw, ExternalLink, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';

const DEPARTMENTS = [
  { id: '', label: 'All Departments' },
  { id: 'CSC', label: 'Computer Science (CSC)' },
  { id: 'CYS', label: 'Cyber Security (CYS)' },
  { id: 'SEN', label: 'Software Engineering (SEN)' },
  { id: 'DSC', label: 'Data Science (DSC)' },
  { id: 'IFS', label: 'Information Systems (IFS)' },
  { id: 'IFT', label: 'Information Technology (IFT)' },
  { id: 'LIS', label: 'Library & Info Science (LIS)' },
];

const LEVELS = [
  { id: '', label: 'All Levels' },
  { id: '100', label: '100 Level' },
  { id: '200', label: '200 Level' },
  { id: '300', label: '300 Level' },
  { id: '400', label: '400 Level' },
];

const SESSIONS = [
  { id: '', label: 'All Academic Sessions' },
  { id: '2023/2024', label: '2023/2024 Academic Session' },
  { id: '2022/2023', label: '2022/2023 Academic Session' },
  { id: '2021/2022', label: '2021/2022 Academic Session' },
];

const SEMESTERS = [
  { id: '', label: 'All Semesters' },
  { id: '1', label: 'Harmattan Semester (First)' },
  { id: '2', label: 'Rain Semester (Second)' },
];

const RESOURCE_TYPES = [
  { id: '', label: 'All Document Classifications' },
  { id: 'HANDBOOK', label: 'Student Handbooks' },
  { id: 'RESEARCH_TEMPLATE', label: 'FYP Templates (LaTeX / Word)' },
  { id: 'POLICY_DOCUMENT', label: 'Policies & SIWES Guidelines' },
  { id: 'CURRICULUM_GUIDE', label: 'Curriculum Outlines' },
];

export function MultiDimensionalFilterBar({
  category,
  departmentId,
  level,
  session,
  semester,
  courseId,
  itemType,
  courseCatalog = [],
  onFilterChange,
  onResetFilters,
  hasActiveFilters,
}) {
  const activeCount = [departmentId, level, session, semester, courseId, itemType].filter(Boolean).length;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
      {/* Header filter title and reset actions */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <Filter className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
          <span>Filter Repository</span>
          {activeCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
              {activeCount} active
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {category === 'courses' && courseId && (
            <Link
              to={`/courses/${encodeURIComponent(courseId)}?tab=materials`}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/60 transition-colors"
            >
              <span>Open Course Room</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          )}

          {hasActiveFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset All</span>
            </button>
          )}
        </div>
      </div>

      {/* Selectors Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Department Filter (Universal) */}
        <div className="space-y-1.5">
          <label htmlFor="dept-filter" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Department
          </label>
          <div className="relative">
            <select
              id="dept-filter"
              value={departmentId || ''}
              onChange={(e) => onFilterChange('departmentId', e.target.value)}
              className="w-full appearance-none pl-3.5 pr-9 py-2.5 text-xs font-medium rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 transition-all cursor-pointer"
            >
              {DEPARTMENTS.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.label}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Academic Level Filter (Universal) */}
        <div className="space-y-1.5">
          <label htmlFor="level-filter" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Academic Level
          </label>
          <div className="relative">
            <select
              id="level-filter"
              value={level || ''}
              onChange={(e) => onFilterChange('level', e.target.value)}
              className="w-full appearance-none pl-3.5 pr-9 py-2.5 text-xs font-medium rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 transition-all cursor-pointer"
            >
              {LEVELS.map((lvl) => (
                <option key={lvl.id} value={lvl.id}>
                  {lvl.label}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Category-Specific Filters */}
        {category === 'courses' && (
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="course-picker" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Filter by Course Room
            </label>
            <div className="relative">
              <select
                id="course-picker"
                value={courseId || ''}
                onChange={(e) => onFilterChange('courseId', e.target.value)}
                className="w-full appearance-none pl-3.5 pr-9 py-2.5 text-xs font-medium rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 transition-all cursor-pointer"
              >
                <option value="">All Faculty Courses</option>
                {courseCatalog.map((c) => (
                  <option key={c.course_id} value={c.course_id}>
                    {c.code}: {c.title} {c.is_enrolled ? '★ (Enrolled)' : ''} ({c.material_count} files)
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        )}

        {category === 'past_questions' && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="session-filter" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Academic Session
              </label>
              <div className="relative">
                <select
                  id="session-filter"
                  value={session || ''}
                  onChange={(e) => onFilterChange('session', e.target.value)}
                  className="w-full appearance-none pl-3.5 pr-9 py-2.5 text-xs font-medium rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 transition-all cursor-pointer"
                >
                  {SESSIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="semester-filter" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Semester Term
              </label>
              <div className="relative">
                <select
                  id="semester-filter"
                  value={semester || ''}
                  onChange={(e) => onFilterChange('semester', e.target.value)}
                  className="w-full appearance-none pl-3.5 pr-9 py-2.5 text-xs font-medium rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 transition-all cursor-pointer"
                >
                  {SEMESTERS.map((sem) => (
                    <option key={sem.id} value={sem.id}>
                      {sem.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          </>
        )}

        {category === 'faculty_resources' && (
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="resource-type-filter" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Document Classification
            </label>
            <div className="relative">
              <select
                id="resource-type-filter"
                value={itemType || ''}
                onChange={(e) => onFilterChange('itemType', e.target.value)}
                className="w-full appearance-none pl-3.5 pr-9 py-2.5 text-xs font-medium rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 transition-all cursor-pointer"
              >
                {RESOURCE_TYPES.map((rt) => (
                  <option key={rt.id} value={rt.id}>
                    {rt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
