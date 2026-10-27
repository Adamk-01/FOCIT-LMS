/** @type {import('tailwindcss').Config} */
function withOpacity(variableName) {
  return `rgb(var(${variableName}) / <alpha-value>)`;
}

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: withOpacity('--color-blue-primary-rgb'),
          dark: withOpacity('--color-blue-dark-rgb'),
          darker: withOpacity('--color-blue-darker-rgb'),
          light: withOpacity('--color-blue-light-rgb'),
          lightest: withOpacity('--color-blue-lightest-rgb'),
          gold: withOpacity('--color-gold-rgb'),
          'gold-dark': withOpacity('--color-gold-dark-rgb'),
          'gold-light': withOpacity('--color-gold-light-rgb'),
          purple: withOpacity('--color-purple-rgb'),
          'purple-dark': withOpacity('--color-purple-dark-rgb'),
          'purple-light': withOpacity('--color-purple-light-rgb'),
          'purple-lightest': withOpacity('--color-purple-lightest-rgb'),
        },
        surface: {
          DEFAULT: withOpacity('--color-surface-rgb'),
          alt: withOpacity('--color-surface-alt-rgb'),
          elevated: withOpacity('--color-surface-elevated-rgb'),
          border: withOpacity('--color-border-rgb'),
          'border-light': withOpacity('--color-border-light-rgb'),
        },
        focitText: {
          primary: withOpacity('--color-text-primary-rgb'),
          secondary: withOpacity('--color-text-secondary-rgb'),
          muted: withOpacity('--color-text-muted-rgb'),
          onDark: withOpacity('--color-text-on-dark-rgb'),
          onBlue: withOpacity('--color-text-on-blue-rgb'),
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Merriweather', 'serif'],
        display: ['Outfit', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        'nav': '0 2px 12px rgba(10, 17, 66, 0.08)',
        'card': '0 4px 16px -2px rgba(10, 17, 66, 0.06), 0 2px 6px -1px rgba(10, 17, 66, 0.04)',
        'elevated': '0 12px 30px -4px rgba(10, 17, 66, 0.12), 0 4px 10px -2px rgba(10, 17, 66, 0.06)',
      }
    },
  },
  plugins: [],
}
