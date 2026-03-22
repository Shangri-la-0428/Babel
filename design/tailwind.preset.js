/**
 * BABEL Design System — Tailwind CSS Preset
 *
 * Usage in tailwind.config.js:
 *   const babelPreset = require('./design/tailwind.preset.js')
 *   module.exports = { presets: [babelPreset], ... }
 */

module.exports = {
  theme: {
    fontFamily: {
      mono: ['var(--font-jetbrains)', 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', 'monospace'],
      sans: ['var(--font-inter)', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
    },

    fontSize: {
      'display':    ['6rem',       { lineHeight: '1',   letterSpacing: '-0.02em', fontWeight: '900' }],
      'display-sm': ['4rem',       { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
      'title':      ['3rem',       { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
      'heading':    ['2rem',       { lineHeight: '1.1', fontWeight: '600' }],
      'subheading': ['1.25rem',    { lineHeight: '1.3', fontWeight: '500' }],
      'body':       ['0.9375rem',  { lineHeight: '1.5' }],
      'detail':     ['0.8125rem',  { lineHeight: '1.5' }],
      'micro':      ['0.6875rem',  { lineHeight: '1.5', letterSpacing: '0.1em', fontWeight: '500' }],
    },

    letterSpacing: {
      tight:   '-0.02em',
      normal:  '0',
      wide:    '0.05em',
      wider:   '0.1em',
      widest:  '0.2em',
    },

    borderRadius: {
      none: '0',
      DEFAULT: '0',
    },

    extend: {
      colors: {
        void:    '#000000',

        surface: {
          1: '#0A0A0A',
          2: '#111111',
          3: '#1C1C1C',
          4: '#252525',
        },

        // Semantic text colors — use as text-t-*, bg-t-* to avoid clash with Tailwind text-* utilities
        t: {
          DEFAULT:   '#FFFFFF',
          secondary: '#A0A0A0',
          muted:     '#7A7A7A',
          dim:       '#525252',
        },

        primary: {
          DEFAULT: '#C0FE04',
          dim:     '#8AB503',
          glow:    'rgba(192, 254, 4, 0.15)',
          'glow-strong': 'rgba(192, 254, 4, 0.3)',
        },

        danger:  { DEFAULT: '#F24723', dim: '#A83018' },
        warning: { DEFAULT: '#FFB800', dim: '#B38200' },
        info:    { DEFAULT: '#0EA5E9', dim: '#0A7EAD' },

        b: {
          DEFAULT: '#1C1C1C',
          hover:   '#333333',
          active:  '#C0FE04',
        },
      },

      spacing: {
        'nav':     '56px',
        'control': '56px',
        'btn':     '48px',
        'btn-sm':  '36px',
        'input':   '48px',
      },

      transitionDuration: {
        'instant': '50ms',
        'fast':    '100ms',
        'normal':  '150ms',
        'slow':    '300ms',
        'slower':  '500ms',
        'reveal':  '800ms',
      },

      transitionTimingFunction: {
        'default': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'in':      'cubic-bezier(0.4, 0, 1, 1)',
        'out':     'cubic-bezier(0, 0, 0.2, 1)',
      },

      zIndex: {
        'dropdown': '100',
        'sticky':   '200',
        'overlay':  '300',
        'modal':    '400',
        'toast':    '500',
      },

      animation: {
        'fade-in':      'fade-in 300ms ease both',
        'slide-up':     'slide-up 300ms cubic-bezier(0, 0, 0.2, 1) both',
        'reveal-right': 'reveal-right 800ms cubic-bezier(0, 0, 0.2, 1) both',
        'pulse-glow':   'pulse-glow 2s ease infinite',
        'blink':        'blink 1s step-end infinite',
        'marquee':      'marquee 16s linear infinite',
        'shimmer':      'shimmer 1.5s ease infinite',
        'tick-bump':    'tick-bump 300ms cubic-bezier(0, 0, 0.2, 1)',
      },

      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'reveal-right': {
          from: { clipPath: 'inset(0 100% 0 0)' },
          to:   { clipPath: 'inset(0 0 0 0)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(192, 254, 4, 0.15)' },
          '50%':      { boxShadow: '0 0 20px 4px rgba(192, 254, 4, 0.15)' },
        },
        'blink': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0' },
        },
        'marquee': {
          from: { transform: 'translateX(0)' },
          to:   { transform: 'translateX(-50%)' },
        },
        'shimmer': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'tick-bump': {
          '0%':   { transform: 'scale(1)' },
          '40%':  { transform: 'scale(1.08)' },
          '100%': { transform: 'scale(1)' },
        },
      },
    },
  },
}
