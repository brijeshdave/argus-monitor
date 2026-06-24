/**
 * Argus — Monitoring Platform · Author: Brijesh Dave <https://github.com/brijeshdave>
 * Tailwind config. The "Refined SCADA dark" palette is mapped onto the slate +
 * sky scales the components already use, so the whole app reskins without
 * touching every className. Status-semantic colors + the fonts are added too. Raw
 * token values live in src/index.css (:root).
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", '"Cascadia Code"', "monospace"],
      },
      colors: {
        // Neutrals → SCADA tones (used app-wide as bg/border/text).
        slate: {
          50: "#f7fafc",
          100: "#eef3f9", // text-primary
          200: "#dfe7f1",
          300: "#cdd8e6",
          400: "#b8c5d6", // text-secondary
          500: "#8a9cb0", // text-muted
          600: "#6a7c91", // text-dim
          700: "#38465a", // border-bright / input border
          800: "#232c38", // border
          850: "#181d25", // panel-raised
          900: "#12161c", // panel
          950: "#0a0d12", // base background
        },
        // Accent → the accent blue.
        sky: {
          300: "#7aa9f7",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2f6fd6",
          700: "#2660bd",
        },
        // Status-semantic palette (badges, LEDs, tile accents).
        status: {
          up: "#22c55e",
          degraded: "#f97316",
          hang: "#f59e0b",
          down: "#ef4444",
          unknown: "#6b7280",
        },
      },
    },
  },
  plugins: [],
};
