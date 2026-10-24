/**
 * Preferences & Theme Runtime Manager
 *
 * Implements:
 * 1. Runtime Theme Switching (System | Light | Dark) with media query listener
 * 2. High-Density Table Viewport Manager (Compact Gradebook)
 * 3. LocalStorage persistence and boot hydration
 *
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */

export const THEME_STORAGE_KEY = 'focit_theme';
export const COMPACT_STORAGE_KEY = 'focit_compact_tables';
export const PREFS_STORAGE_KEY = 'focit_preferences';

/**
 * Applies color scheme to the HTML document root.
 * @param {'system' | 'light' | 'dark'} theme
 * @param {boolean} persist
 */
export function applyTheme(theme = 'system', persist = false) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  if (isDark) {
    root.classList.add('dark');
    root.setAttribute('data-theme', 'dark');
  } else {
    root.classList.remove('dark');
    root.setAttribute('data-theme', 'light');
  }

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (_) {}
  }
}

/**
 * Applies high-density row padding across grade tables.
 * @param {boolean} isCompact
 * @param {boolean} persist
 */
export function applyTableDensity(isCompact = false, persist = false) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (isCompact) {
    root.classList.add('compact-tables');
    root.setAttribute('data-compact-tables', 'true');
  } else {
    root.classList.remove('compact-tables');
    root.removeAttribute('data-compact-tables');
  }

  if (persist) {
    try {
      localStorage.setItem(COMPACT_STORAGE_KEY, isCompact ? 'true' : 'false');
    } catch (_) {}
  }
}

/**
 * Applies all user preferences simultaneously (theme, table density, etc.).
 * @param {Object} prefs
 * @param {boolean} persist
 */
export function applyAllPreferences(prefs = {}, persist = false) {
  if (!prefs || typeof prefs !== 'object') return;

  if (prefs.theme) {
    applyTheme(prefs.theme, persist);
  }
  if (typeof prefs.compact_tables === 'boolean') {
    applyTableDensity(prefs.compact_tables, persist);
  }

  if (persist) {
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch (_) {}
  }
}

/**
 * Hydrates stored preferences from LocalStorage upon application boot.
 */
export function initPreferencesOnBoot() {
  if (typeof window === 'undefined') return;

  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'system';
    applyTheme(savedTheme);

    const savedCompact = localStorage.getItem(COMPACT_STORAGE_KEY) === 'true';
    applyTableDensity(savedCompact);

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const currentTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'system';
        if (currentTheme === 'system') {
          applyTheme('system');
        }
      });
    }
  } catch (_) {}
}
