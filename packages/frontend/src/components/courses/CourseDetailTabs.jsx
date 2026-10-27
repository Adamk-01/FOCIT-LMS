import React from 'react';
import { 
  BookOpen, 
  FileText, 
  Calendar, 
  HelpCircle, 
  MessagesSquare, 
  Award 
} from 'lucide-react';

export const COURSE_TABS = [
  { id: 'overview', label: 'Overview', icon: BookOpen },
  { id: 'materials', label: 'Materials', icon: FileText },
  { id: 'assignments', label: 'Assignments', icon: Calendar },
  { id: 'quizzes', label: 'Quizzes', icon: HelpCircle },
  { id: 'forum', label: 'Forum', icon: MessagesSquare },
  { id: 'grades', label: 'Grades', icon: Award },
];

/**
 * <CourseDetailTabs />
 *
 * Course detail tab bar with WCAG 44x44px touch targets.
 */
export function CourseDetailTabs({
  activeTab = 'overview',
  onTabChange,
}) {
  return (
    <nav aria-label="Course Navigation Tabs" className="border-b border-gray-200 dark:border-slate-800">
      <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {COURSE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`
                flex items-center gap-2 min-h-[44px] px-5 py-3 text-sm font-bold border-b-2 transition-all whitespace-nowrap
                ${isActive 
                  ? 'border-[#0a1142] text-[#0a1142] dark:border-indigo-400 dark:text-indigo-400' 
                  : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200 hover:border-gray-300 dark:hover:border-slate-700'}
              `}
            >
              <Icon size={16} className={isActive ? 'text-[#0a1142] dark:text-indigo-400' : 'text-gray-400 dark:text-slate-500'} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default CourseDetailTabs;
