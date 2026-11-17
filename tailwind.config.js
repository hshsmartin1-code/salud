/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    // `text-body` is the 15 px size token, so the "body" domain colour is excluded from text colours
    // (use text-[rgb(var(--body))]); bg-body, border-body and ring-body keep working.
    textColor: ({ theme }) => {
      const { body: _body, ...rest } = theme('colors')
      return rest
    },
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
        energy: v('energy'),
        move: v('move'),
        train: v('train'),
        sleep: v('sleep'),
        body: v('body'),
        heart: v('heart'),
        water: v('water'),
      },
      fontFamily: {
        sans: ['"Archivo Variable"', 'Archivo', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      // V3 type scale (the project notes §2). Never go below `micro` (11 px).
      fontSize: {
        display: ['40px', { lineHeight: '40px' }],
        readout: ['28px', { lineHeight: '28px' }],
        title: ['24px', { lineHeight: '28px' }],
        heading: ['17px', { lineHeight: '22px', fontWeight: '600' }],
        body: ['15px', { lineHeight: '22px' }],
        label: ['13px', { lineHeight: '18px' }],
        micro: ['11px', { lineHeight: '14px' }],
      },
      // Motion: 120 ms state, 200 ms sheet/toast entry, 320 ms progress.
      transitionDuration: { state: '120ms', enter: '200ms', progress: '320ms' },
      borderRadius: { lg: '0.5rem', xl: '0.625rem', '2xl': '0.875rem', '3xl': '1.125rem' },
      boxShadow: {
        card: 'none',
        lift: '0 1px 2px rgb(18 26 33 / 0.06)',
      },
    },
  },
  plugins: [],
}
