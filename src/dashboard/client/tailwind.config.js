/** @type {import('tailwindcss').Config} */

// Phase 116 — ClawCode dashboard v2 Tailwind config.
//
// Design tokens locked per 116-CONTEXT.md aesthetic section. Dark base
// (#0e0e12) + emerald primary (#10b981) + Cabinet Grotesk display +
// Geist body + JetBrains Mono data. Breakpoints override Tailwind
// defaults to match the mobile-first design lock (375 / 768 / 1024 /
// 1280 / 1920).
//
// Tier 1 components in Plan 116-01 will consume these tokens via
// `bg-bg-base`, `text-fg-1`, `font-display`, `md:grid-cols-2`, etc.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  // Breakpoints — explicit OVERRIDE of Tailwind defaults (NOT additive).
  // Plan 116-00 T06: 375 / 768 / 1024 / 1280 / 1920.
  theme: {
    screens: {
      sm: '375px', // iPhone SE — mobile-first basic-mode default
      md: '768px', // tablet portrait — 2-column tile grid
      lg: '1024px', // tablet landscape / small laptop — sidebar fixed
      xl: '1280px', // laptop — 3-column tile grid
      '2xl': '1920px', // desktop — 4-column tile grid
    },
    extend: {
      colors: {
        // Surfaces — dark mode primary. fg.1 highest contrast text;
        // fg.3 secondary metadata. bg.s3 = drawer / detail panel.
        bg: {
          base: '#0e0e12',
          elevated: '#16161c',
          muted: '#1c1c24',
          s3: '#252530',
        },
        fg: {
          1: '#f4f4f5',
          2: '#a1a1aa',
          3: '#71717a',
        },
        // Status palette — locked from 116-CONTEXT aesthetic section.
        // SLO gauges in F03 + agent tile borders consume these directly.
        primary: '#10b981', // emerald — healthy / active
        info: '#3b82f6', // blue — informational
        warn: '#f59e0b', // amber — degraded / warning
        danger: '#ef4444', // red — breach / errored
        gold: '#eab308', // yellow — escalation / priority
        pink: '#ff3366', // magenta — accent / SLO-breach banner highlight
      },
      fontFamily: {
        // Headings + display copy — Cabinet Grotesk (free, Indian Type
        // Foundry). Self-hosted WOFF2 from public/fonts/.
        display: ['"Cabinet Grotesk"', 'system-ui', 'sans-serif'],
        // Body copy — Geist (Vercel OFL). Self-hosted WOFF2.
        sans: ['Geist', 'system-ui', 'sans-serif'],
        // Numerals + code + tabular metric values — JetBrains Mono.
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
