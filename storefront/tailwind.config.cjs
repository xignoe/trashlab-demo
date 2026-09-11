/** Tailwind v3 theme that reads every color, radius, font family, font size and
 *  spacing step from the CSS variables in src/styles/tokens.css. Components use
 *  these utilities (bg-accent, text-ink, rounded-lg, ...) and never a hex literal. */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: 'var(--color-white)',
      gray: {
        50: 'var(--color-gray-50)',
        100: 'var(--color-gray-100)',
        200: 'var(--color-gray-200)',
        400: 'var(--color-gray-400)',
        600: 'var(--color-gray-600)',
        900: 'var(--color-gray-900)',
      },
      accent: {
        DEFAULT: 'var(--color-accent)',
        strong: 'var(--color-accent-strong)',
        soft: 'var(--color-accent-soft)',
      },
      // Phase 7, trashlab.com: `brand` is the same indigo as `accent`, named the way the site names it.
      brand: { DEFAULT: 'var(--color-accent)', deep: 'var(--color-brand-deep)' },
      'brand-deep': 'var(--color-brand-deep)',
      cyan: 'var(--color-cyan)',
      lavender: 'var(--color-lavender)',
      'hairline-on-brand': 'var(--color-hairline-on-brand)',
      'on-brand': {
        DEFAULT: 'var(--color-on-brand)',
        85: 'var(--color-on-brand-85)',
        80: 'var(--color-on-brand-80)',
        25: 'var(--color-on-brand-25)',
        18: 'var(--color-on-brand-18)',
        12: 'var(--color-on-brand-12)',
      },
      success: { DEFAULT: 'var(--color-success)', soft: 'var(--color-success-soft)' },
      warning: { DEFAULT: 'var(--color-warning)', soft: 'var(--color-warning-soft)' },
      danger: { DEFAULT: 'var(--color-danger)', soft: 'var(--color-danger-soft)' },
      bg: 'var(--color-bg)',
      surface: 'var(--color-surface)',
      ink: { DEFAULT: 'var(--color-ink)', muted: 'var(--color-ink-muted)' },
      line: 'var(--color-line)',
    },
    borderRadius: {
      none: '0',
      sm: 'var(--radius-sm)',
      DEFAULT: 'var(--radius-sm)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
      xl: 'var(--radius-xl)',
      pill: 'var(--radius-pill)',
      full: '9999px',
    },
    fontFamily: {
      sans: 'var(--font-sans)',
    },
    // Sizes carry line height only (plus tracking on display), never a weight: components set the weight
    // with font-medium, font-semibold, or font-bold so one class always decides it.
    fontSize: {
      display: ['var(--text-display)', { lineHeight: 'var(--leading-display)', letterSpacing: 'var(--tracking-display)' }],
      title: ['var(--text-title)', { lineHeight: 'var(--leading-title)' }],
      stat: ['var(--text-stat)', { lineHeight: 'var(--leading-stat)' }],
      heading: ['var(--text-heading)', { lineHeight: 'var(--leading-heading)' }],
      eyebrow: ['var(--text-eyebrow)', { lineHeight: 'var(--leading-eyebrow)' }],
      lede: ['var(--text-lede)', { lineHeight: 'var(--leading-lede)' }],
      body: ['var(--text-body)', { lineHeight: 'var(--leading-body)' }],
      row: ['var(--text-row)', { lineHeight: 'var(--leading-row)' }],
      label: ['var(--text-label)', { lineHeight: 'var(--leading-label)' }],
      small: ['var(--text-small)', { lineHeight: 'var(--leading-small)' }],
    },
    extend: {
      spacing: {
        1: 'var(--spacing-1)',
        2: 'var(--spacing-2)',
        3: 'var(--spacing-3)',
        4: 'var(--spacing-4)',
        5: 'var(--spacing-5)',
        6: 'var(--spacing-6)',
        8: 'var(--spacing-8)',
        12: 'var(--spacing-12)',
        header: 'var(--size-header)',
        button: 'var(--size-button)',
        'button-compact': 'var(--size-button-compact)',
      },
      maxWidth: {
        page: 'var(--size-page)',
      },
    },
  },
  plugins: [],
};
