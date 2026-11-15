/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        surface2: v('surface2'),
        line: v('line'),
        'line-strong': v('line-strong'),
        ink: v('ink'),
        'ink-contrast': v('ink-contrast'),
        muted: v('muted'),
        faint: v('faint'),
        accent: v('accent'),
        'accent-ink': v('accent-ink'),
        good: v('good'),
        warn: v('warn'),
        bad: v('bad'),
        protein: v('protein'),
        carbs: v('carbs'),
        fat: v('fat'),
        fiber: v('fiber'),
        kcal: v('kcal'),
      },
      fontFamily: {
        sans: ['"Archivo Variable"', 'Archivo', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: { lg: '0.5rem', xl: '0.625rem', '2xl': '0.875rem', '3xl': '1.125rem' },
      boxShadow: {
        card: 'none',
        lift: '0 1px 2px rgb(18 26 33 / 0.06)',
      },
    },
  },
  plugins: [],
}
