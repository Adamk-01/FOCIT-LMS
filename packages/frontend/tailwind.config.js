/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#0a1142',
          dark: '#070c2e',
          darker: '#040617',
          light: '#16258f',
          lightest: '#e6e8f4',
          gold: '#ffb81c',
          'gold-dark': '#e5a200',
          'gold-light': '#ffd060',
          purple: '#6b21a8',
          'purple-dark': '#581c87',
          'purple-light': '#8b5cf6',
          'purple-lightest': '#f3e8ff',
        },
        surface: {
          DEFAULT: '#ffffff',
          alt: '#f8fafc',
          elevated: '#ffffff',
          border: '#e2e8f0',
          'border-light': '#f1f5f9',
        },
        focitText: {
          primary: '#0f172a',
          secondary: '#475569',
          muted: '#94a3b8',
          onDark: '#f8fafc',
          onBlue: '#ffffff',
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
