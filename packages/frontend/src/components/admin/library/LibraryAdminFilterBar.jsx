import React from 'react';
import { Search, Plus, Filter, RotateCcw } from 'lucide-react';

export function LibraryAdminFilterBar({
  searchQuery,
  onSearchChange,
  category,
  onCategoryChange,
  status,
  onStatusChange,
  departmentId,
  onDepartmentChange,
  onOpenUpload,
  onResetFilters,
  canFilterDepartment = true,
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
      {/* Search Input */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by title, author, course code, or filename..."
          className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Filter Selects & Status Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Category Selector */}
        <select
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">All Categories</option>
          <option value="courses">Course Materials</option>
          <option value="textbooks">Textbooks & E-Books</option>
          <option value="past_questions">Past Questions Vault</option>
          <option value="faculty_resources">Faculty Resources</option>
        </select>

        {/* Department Selector (for Admins & Deans) */}
        {canFilterDepartment && (
          <select
            value={departmentId}
            onChange={(e) => onDepartmentChange(e.target.value)}
            className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Departments</option>
            <option value="CSC">Computer Science (CSC)</option>
            <option value="IFT">Information Technology (IFT)</option>
            <option value="SWE">Software Engineering (SWE)</option>
            <option value="CYB">Cybersecurity (CYB)</option>
          </select>
        )}

        {/* Status Tab Group */}
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800 text-xs">
          {[
            { id: 'all', label: 'All' },
            { id: 'published', label: 'Published' },
            { id: 'embargoed', label: 'Embargoed' },
            { id: 'draft', label: 'Drafts' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onStatusChange(tab.id)}
              className={`px-2.5 py-1.5 rounded-md font-medium transition-all ${
                status === tab.id
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Clear Filters */}
        <button
          type="button"
          onClick={onResetFilters}
          className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Reset Filters"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        {/* Ingest Action Button */}
        <button
          type="button"
          onClick={onOpenUpload}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors ml-auto sm:ml-0"
        >
          <Plus className="w-4 h-4" />
          Ingest Resource
        </button>
      </div>
    </div>
  );
}

