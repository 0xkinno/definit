import type { Config } from "tailwindcss";

/**
 * DEFINIT design tokens.
 *
 * Warm paper, graphite ink, restrained brass. No neon, no glassmorphism
 * wallpaper, no generic crypto green. The palette is meant to read like a
 * financial instrument rather than an arcade.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          0: "#FFFDF9",
          50: "#FBF8F2",
          100: "#F5F1E8",
          200: "#EDE7DA",
          300: "#E1D9C9",
        },
        ink: {
          900: "#131518",
          800: "#1E2126",
          700: "#33383F",
          600: "#4A5058",
          500: "#6B7078",
          400: "#8C9199",
          300: "#B3B7BE",
        },
        brass: {
          700: "#7A5518",
          600: "#96691F",
          500: "#B07E28",
          400: "#C79A4A",
          300: "#E0C48C",
          100: "#F3E7CE",
        },
        viridian: {
          700: "#14513F",
          600: "#1B6A53",
          500: "#22836A",
          300: "#7FBBA6",
          100: "#DCEDE6",
        },
        signal: {
          amber: "#A9700F",
          ambersoft: "#F6E9CF",
          rust: "#8F3A2E",
          rustsoft: "#F6E2DD",
          slate: "#48505F",
          slatesoft: "#E6E8EC",
        },
      },
      fontFamily: {
        display: [
          "Fraunces",
          "Iowan Old Style",
          "Palatino Linotype",
          "Palatino",
          "Georgia",
          "serif",
        ],
        sans: [
          "Manrope",
          "Segoe UI Variable Text",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "SFMono-Regular",
          "Cascadia Mono",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      letterSpacing: {
        tightest: "-0.03em",
        editorial: "-0.015em",
      },
      boxShadow: {
        instrument: "0 1px 2px rgba(19,21,24,0.04), 0 12px 32px -18px rgba(19,21,24,0.28)",
        raised: "0 1px 1px rgba(19,21,24,0.05), 0 24px 60px -32px rgba(19,21,24,0.35)",
      },
      maxWidth: {
        prose: "68ch",
      },
    },
  },
  plugins: [],
};

export default config;
