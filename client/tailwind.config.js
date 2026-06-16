/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#05070a',
          900: '#0a0e14',
          800: '#10151d',
          700: '#161c26',
          600: '#1f2733',
        },
        accent: {
          DEFAULT: '#3ddcff',
          dim: '#1d8fa8',
          warn: '#ffb84d',
          danger: '#ff5d5d',
          ok: '#52e3a4',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 0 0 1px rgba(61,220,255,0.08), 0 8px 32px rgba(0,0,0,0.55)',
        glow: '0 0 16px rgba(61,220,255,0.35)',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
