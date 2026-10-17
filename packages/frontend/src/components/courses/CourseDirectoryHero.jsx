import React from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Layers } from 'lucide-react';

/**
 * <CourseDirectoryHero />
 *
 * Header card for CoursesPage displaying term metadata and live telemetry counters.
 */
export function CourseDirectoryHero({
  termName = '2026/2027 Rain Semester',
  department = 'Department of Computer Science',
  level = 200,
  totalModules = 0,
  totalUnits = 0,
  inProgressCount = 0,
  completedCount = 0,
}) {
  return (
    <header className="bg-gradient-to-r from-[#0a1142] via-[#0d1656] to-[#0a1142] rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden border border-white/10">
      <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-[#ffb81c]/15 to-transparent pointer-events-none" />
      
      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-[#ffb81c]/20 text-[#ffb81c] border border-[#ffb81c]/30">
            <GraduationCap size={14} aria-hidden="true" />
            <span>{termName}</span>
          </div>
          
          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight font-display text-white">
            My Registered Courses
          </h1>
          
          <p className="text-gray-300 text-sm sm:text-base font-medium max-w-2xl leading-relaxed font-sans">
            Faculty of Computing & Information Technology • {department} • Level {level}
          </p>
        </div>

        <Link
          to="/registration"
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-3 rounded-xl bg-[#ffb81c] hover:bg-[#e5a415] text-[#0a1142] text-xs font-extrabold shadow-lg transition-all shrink-0"
        >
          <Layers size={16} aria-hidden="true" />
          <span>Manage Course Registration</span>
        </Link>
      </div>

      {/* Telemetry Metric Badges */}
      <div className="mt-8 pt-6 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white/5 backdrop-blur-sm rounded-xl p-3.5 border border-white/10">
          <p className="text-xs text-gray-300 font-medium font-sans">Registered Modules</p>
          <p className="text-2xl font-extrabold text-[#ffb81c] mt-0.5 font-display">{totalModules}</p>
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-xl p-3.5 border border-white/10">
          <p className="text-xs text-gray-300 font-medium font-sans">Total Credit Units</p>
          <p className="text-2xl font-extrabold text-white mt-0.5 font-display">{totalUnits} Units</p>
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-xl p-3.5 border border-white/10">
          <p className="text-xs text-gray-300 font-medium font-sans">In Progress</p>
          <p className="text-2xl font-extrabold text-emerald-400 mt-0.5 font-display">{inProgressCount}</p>
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-xl p-3.5 border border-white/10">
          <p className="text-xs text-gray-300 font-medium font-sans">Completed</p>
          <p className="text-2xl font-extrabold text-cyan-300 mt-0.5 font-display">{completedCount}</p>
        </div>
      </div>
    </header>
  );
}

export default CourseDirectoryHero;
