/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['"Encode Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        serif: ['Merriweather', 'Georgia', 'Cambria', '"Times New Roman"', 'serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // The code-block panel's board. Registered as `hsl(var(--…))` rather
        // than a complete value so the opacity modifier works: the chat
        // transcript draws `bg-code-block/50`, the same half-transparent shape
        // it used with `--muted`.
        "code-block": "hsl(var(--code-block-bg))",
        // Compatibility scale (`n-` = neutral). The skeleton still carries
        // Tailwind's named neutrals (`bg-gray-100 dark:bg-gray-700`); as each
        // cluster migrates it keeps the exact step but routes it through a
        // token, so `bg-n-gray-100` renders what `bg-gray-100` rendered while
        // becoming theme-controllable. `gray` carries the bulk; `zinc` /
        // `slate` / `neutral` keep their own hue for the same reason — folding
        // them into `gray` would move the pixel. Values live in `src/index.css`
        // (`--n-*`); `src/shared/tests/neutralScale.test.ts` proves the chain
        // class -> token -> palette is byte-identical to the literal it
        // replaces. Phase 2 renames these to semantic tokens and drops the
        // keys.
        "n-gray": {
          50: "hsl(var(--n-gray-50))",
          100: "hsl(var(--n-gray-100))",
          200: "hsl(var(--n-gray-200))",
          300: "hsl(var(--n-gray-300))",
          400: "hsl(var(--n-gray-400))",
          500: "hsl(var(--n-gray-500))",
          600: "hsl(var(--n-gray-600))",
          700: "hsl(var(--n-gray-700))",
          800: "hsl(var(--n-gray-800))",
          900: "hsl(var(--n-gray-900))",
          950: "hsl(var(--n-gray-950))",
        },
        "n-white": "hsl(var(--n-white))",
        "n-black": "hsl(var(--n-black))",
        "n-zinc": {
          50: "hsl(var(--n-zinc-50))",
          100: "hsl(var(--n-zinc-100))",
          200: "hsl(var(--n-zinc-200))",
          300: "hsl(var(--n-zinc-300))",
          400: "hsl(var(--n-zinc-400))",
          500: "hsl(var(--n-zinc-500))",
          600: "hsl(var(--n-zinc-600))",
          700: "hsl(var(--n-zinc-700))",
          800: "hsl(var(--n-zinc-800))",
          900: "hsl(var(--n-zinc-900))",
          950: "hsl(var(--n-zinc-950))",
        },
        "n-slate": {
          50: "hsl(var(--n-slate-50))",
          100: "hsl(var(--n-slate-100))",
          200: "hsl(var(--n-slate-200))",
          300: "hsl(var(--n-slate-300))",
          400: "hsl(var(--n-slate-400))",
          500: "hsl(var(--n-slate-500))",
          600: "hsl(var(--n-slate-600))",
          700: "hsl(var(--n-slate-700))",
          800: "hsl(var(--n-slate-800))",
          900: "hsl(var(--n-slate-900))",
          950: "hsl(var(--n-slate-950))",
        },
        "n-neutral": {
          50: "hsl(var(--n-neutral-50))",
          100: "hsl(var(--n-neutral-100))",
          200: "hsl(var(--n-neutral-200))",
          300: "hsl(var(--n-neutral-300))",
          400: "hsl(var(--n-neutral-400))",
          500: "hsl(var(--n-neutral-500))",
          600: "hsl(var(--n-neutral-600))",
          700: "hsl(var(--n-neutral-700))",
          800: "hsl(var(--n-neutral-800))",
          900: "hsl(var(--n-neutral-900))",
          950: "hsl(var(--n-neutral-950))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      spacing: {
        'safe-area-inset-bottom': 'env(safe-area-inset-bottom)',
        'mobile-nav': 'var(--mobile-nav-total)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'dot-bounce': {
          // reduced-motion freezes the animation on this frame, so 0% must stay
          // at the element's resting position; moving it would freeze the dots
          // out of line.
          '0%, 80%, 100%': { transform: 'translateY(0)' },
          '40%': { transform: 'translateY(-3px)' },
        },
        'dialog-overlay-show': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'dialog-content-show': {
          from: { opacity: '0', transform: 'translate(-50%, -48%) scale(0.96)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
        'bottom-sheet-content-show': {
          from: { opacity: '0', transform: 'translateY(100%)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s linear infinite',
        'dot-bounce': 'dot-bounce 1.2s ease-in-out infinite',
        'dialog-overlay-show': 'dialog-overlay-show 150ms ease-out',
        'dialog-content-show': 'dialog-content-show 150ms ease-out',
        'bottom-sheet-content-show': 'bottom-sheet-content-show 220ms cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
