import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, FileText, HelpCircle, MessagesSquare, Award } from 'lucide-react';

const FOCUS_CONFIG = {
  materials: { label: 'learning materials', icon: FileText },
  quizzes: { label: 'quizzes', icon: HelpCircle },
  grades: { label: 'grades', icon: Award },
  forum: { label: 'discussion forum', icon: MessagesSquare },
};

/**
 * <CourseFocusBanner />
 *
 * Contextual intent banner displayed when redirected with ?focus=materials|quizzes|grades|forum
 */
export function CourseFocusBanner({ focus }) {
  if (!focus) return null;

  const config = FOCUS_CONFIG[focus] || { label: 'module', icon: BookOpen };
  const Icon = config.icon;

  return (
    <aside aria-label="Course Focus Notice" className="bg-indigo-50/90 border border-indigo-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-indigo-950 shadow-xs">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#0a1142] text-[#ffb81c] flex items-center justify-center shrink-0">
          <Icon size={18} aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-bold text-[#0a1142]">
            Select a course to view its {config.label}
          </p>
          <p className="text-[11px] text-gray-600">
            Choose one of your registered courses below to open its dedicated academic workspace.
          </p>
        </div>
      </div>
      <Link
        to="/courses"
        className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 bg-white px-3 py-1.5 rounded-lg border border-indigo-200 shrink-0 self-start sm:self-auto transition-colors"
      >
        Clear Filter
      </Link>
    </aside>
  );
}

export default CourseFocusBanner;
