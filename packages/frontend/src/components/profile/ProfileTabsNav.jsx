import React from 'react';
import { User, FileText, Settings, Lock } from 'lucide-react';

export const PROFILE_TABS = [
  { id: 'overview', label: 'Academic Overview', icon: User },
  { id: 'demographics', label: 'Demographics', icon: FileText },
  { id: 'preferences', label: 'Preferences', icon: Settings },
  { id: 'security', label: 'Security & Auth', icon: Lock },
];

/**
 * <ProfileTabsNav />
 *
 * Semantic tab navigation with WCAG 44x44px touch targets.
 */
export function ProfileTabsNav({ activeTab = 'overview', onTabChange }) {
  return (
    <nav aria-label="Profile Sections" className="border-b border-gray-200">
      <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {PROFILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`
                flex items-center gap-2 min-h-[44px] px-5 py-3 text-xs sm:text-sm font-bold border-b-2 transition-all whitespace-nowrap
                ${isActive
                  ? 'border-[#0a1142] text-[#0a1142]'
                  : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'}
              `}
            >
              <Icon size={16} className={isActive ? 'text-[#0a1142]' : 'text-gray-400'} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default ProfileTabsNav;
