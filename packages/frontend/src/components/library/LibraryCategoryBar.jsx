import React from 'react';
import { FolderOpen, BookOpen, FileCheck, Award, Layers } from 'lucide-react';

const CATEGORY_ICONS = {
  courses: FolderOpen,
  textbooks: BookOpen,
  past_questions: FileCheck,
  faculty_resources: Award,
};

export function LibraryCategoryBar({ categories, activeCategoryId, onSelectCategory }) {
  return (
    <nav 
      aria-label="Library Taxonomy Categories" 
      className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-1.5 shadow-sm overflow-hidden"
    >
      <div 
        role="tablist"
        aria-orientation="horizontal"
        className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth"
      >
        {categories.map((cat) => {
          const Icon = CATEGORY_ICONS[cat.id] || Layers;
          const isActive = activeCategoryId === cat.id;

          return (
            <button
              key={cat.id}
              role="tab"
              type="button"
              id={`tab-${cat.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${cat.id}`}
              onClick={() => onSelectCategory(cat.id)}
              className={`group relative flex items-center gap-2.5 px-5 py-3 text-xs sm:text-sm font-semibold whitespace-nowrap rounded-xl transition-all cursor-pointer ${
                isActive
                  ? 'bg-[#0a1142] dark:bg-indigo-600 text-white shadow-md shadow-[#0a1142]/20 dark:shadow-indigo-600/30 font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100/80 dark:hover:bg-slate-800/60'
              }`}
            >
              <Icon 
                className={`w-4 h-4 transition-colors shrink-0 ${
                  isActive 
                    ? 'text-[#ffb81c] dark:text-white' 
                    : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'
                }`} 
              />
              <span>{cat.name}</span>
              {cat.item_count != null && (
                <span 
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold tracking-tight transition-colors ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 group-hover:bg-slate-200 dark:group-hover:bg-slate-700'
                  }`}
                >
                  {cat.item_count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
