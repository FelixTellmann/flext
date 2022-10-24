/** @type {import('tailwindcss').Config} */
// eslint-disable-next-line node/no-unpublished-require
const plugin = require("tailwindcss/plugin");
// eslint-disable-next-line node/no-unpublished-require
const colors = require("tailwindcss/colors");
const defaultTheme = require("tailwindcss/defaultTheme");
const { default: flattenColorPalette } = require("tailwindcss/lib/util/flattenColorPalette");
const svgToDataUri = require("mini-svg-data-uri");

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`;
}

module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./content/**/*.{js,ts,jsx,tsx}",
    "./client/**/*.{js,ts,jsx,tsx}",
    "./_client/**/*.{js,ts,jsx,tsx}",
    "./update/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class", // or 'media' or 'class'
  // mode: process.env.NODE_ENV ? "jit" : undefined,
  mode: "jit",
  theme: {
    extend: {
      screens: {
        xs: { max: "639px" },
      },
      keyframes: {
        slide: {
          "0%, 100%": {
            transform: "translate3d(0,0,0)",
          },
          "100%": { transform: "translate3d(-50%,0,0)" },
        },
        "hint-hint": {
          "0%, 49%, 53%, 54%, 57%, 100%": {
            opacity: "0",
          },
          "50%, 55%": {
            opacity: "1",
          },
        },
        heartbeat: {
          "0%, 100%": {
            transform: "scale(100%)",
          },
          "50%": {
            transform: "scale(110%)",
          },
        },
        float: {
          "0%, 100%": {
            boxShadow:
              "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(2, 132, 199, 0.2) 0px 25px 50px -12px",
            transform: "translate(0,0)",
          },
          "50%": {
            boxShadow:
              "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(2, 132, 199, 0.2) 0px 10px 25px -3px, rgba(2, 132, 199, 0.2) 0px 4px 6px -4px",
            transform: "translate(4px,20px)",
          },
        },
        blink: {
          "50%": { opacity: "0" },
        },
      },
      animation: {
        slide: "slide 30s linear infinite",
        "hint-hint": "hint-hint 10s linear infinite",
        float: "float 6s ease-in-out infinite",
        heartbeat: "heartbeat 2s ease-in-out infinite",
        blink: "blink 0.75s step-start infinite",
      },
      fontFamily: {
        sans: ["Inter", /*"'Basier Circle'",*/ ...defaultTheme.fontFamily.sans],
        mono: [
          "Consolas",
          `ui-monospace`,
          `SFMono-Regular`,
          `Menlo`,
          `Monaco`,
          "Liberation Mono",
          "Courier New",
          `monospace`,
        ],
      },
      aspectRatio: {
        "4/3": "4 / 3",
        "3/2": "3 / 2",
        "og-image": "1.91 / 1",
      },
      boxShadow: {
        dark: "0 10px 15px -3px rgba(255, 255, 255, 0.1), 0 4px 6px -2px rgba(255, 255, 255, 0.05)",
        glowDark: "0px 2px 25px -4px #427bff",
        glowLight: "0px 2px 12px -4px #e05912",
      },
      spacing: {
        header: "66px",
        wrapper: "62.5rem",
      },
      "shadow-border": `box-shadow: black 0px 0px 0px 2px`,
      maxWidth: {
        "8xl": "90rem",
      },
      colors: {
        bg: "rgb(var(--color-bg) / <alpha-value>)",
        "bg-dark": "rgb(var(--color-bg-dark) / <alpha-value>)",
        "bg-secondary": "rgb(var(--color-bg-secondary) / <alpha-value>)",
        "bg-secondary-dark": "rgb(var(--color-bg-secondary-dark) / <alpha-value>)",
        card: "rgb(var(--color-card) / <alpha-value>)",
        "card-dark": "rgb(var(--color-card-dark) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        "accent-contrast": "rgb(var(--color-accent-contrast) / <alpha-value>)",
        "accent-dark": "rgb(var(--color-accent-dark) / <alpha-value>)",
        "accent-contrast-dark": "rgb(var(--color-accent-contrast-dark) / <alpha-value>)",
        "accent-secondary": "rgb(var(--color-accent-secondary) / <alpha-value>)",
        "accent-secondary-dark": "rgb(var(--color-accent-secondary-dark) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        info: "rgb(var(--color-info) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        dark: {
          border: "#3f3f46",
          bg: "#0e131f",
          card: "#19222e",
          headings: "#eeeef1",
          text: "#aaabb7",
          success: "#06b6d4",
        },
        primary: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
        },
        gray: {
          50: "rgb(var(--color-gray-50) / <alpha-value>)",
          100: "rgb(var(--color-gray-100) / <alpha-value>)",
          200: "rgb(var(--color-gray-200) / <alpha-value>)",
          300: "rgb(var(--color-gray-300) / <alpha-value>)",
          400: "rgb(var(--color-gray-400) / <alpha-value>)",
          500: "rgb(var(--color-gray-500) / <alpha-value>)",
          600: "rgb(var(--color-gray-600) / <alpha-value>)",
          700: "rgb(var(--color-gray-700) / <alpha-value>)",
          800: "rgb(var(--color-gray-800) / <alpha-value>)",
          900: "rgb(var(--color-gray-900) / <alpha-value>)",
        },
      },
      backgroundImage: (theme) => ({
        tick: "url('/icons/tick.svg')",
        gradient1: `radial-gradient(at 100% 100%, rgba(7, 0, 31, 0.07), rgba(88, 5, 171, 0.01), rgba(0, 0, 0, 0)), linear-gradient(to right bottom, rgb(239, 254, 250), rgb(248, 250, 255), rgb(254, 238, 248), rgb(231, 249, 251))`,
        "gradient-stats": `radial-gradient(ellipse 75% 650px at 35% calc(100% + 100px), rgb(var(--color-accent)) 20%, rgb(var(--color-accent) / 10%), rgb(var(--color-bg) / 0))`,
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-radial-to-tr": "radial-gradient(115% 90% at 0% 100%, var(--tw-gradient-stops))",
        "gradient-radial-to-tl": "radial-gradient(115% 90% at 100% 100%, var(--tw-gradient-stops))",
        "gradient-radial-to-br": "radial-gradient(90% 115% at 0% 0%, var(--tw-gradient-stops))",
        "gradient-radial-to-bl": "radial-gradient(90% 115% at 100% 0%, var(--tw-gradient-stops))",
      }),
      typography: ({ theme }) => ({
        dark: {
          css: {
            "--tw-prose-body": colors.slate[400],
            "--tw-prose-pre-code": colors.slate[200],
            "--tw-prose-pre-bg": colors.slate[800],
            "--tw-prose-th-borders": colors.slate[300],
            "--tw-prose-td-borders": colors.slate[200],
            "--tw-prose-headings": colors.white,
            "--tw-prose-lead": colors.slate[400],
            "--tw-prose-links": colors.white,
            "--tw-prose-bold": colors.white,
            "--tw-prose-counters": colors.slate[400],
            "--tw-prose-bullets": colors.slate[600],
            "--tw-prose-hr": colors.slate[700],
            "--tw-prose-quotes": colors.slate[100],
            "--tw-prose-quote-borders": colors.slate[700],
            "--tw-prose-captions": colors.slate[400],
            "--tw-prose-code": colors.white,
            // "--tw-prose-pre-code": colors.slate[300],
            // "--tw-prose-pre-bg": "rgb(0 0 0 / 50%)",
            // "--tw-prose-th-borders": colors.slate[600],
            // "--tw-prose-td-borders": colors.slate[700],
          },
        },
      }),
    },
  },
  variants: {
    extend: {},
  },
  plugins: [
    require("@tailwindcss/forms"),
    require("@tailwindcss/typography"),
    require("@tailwindcss/aspect-ratio"),
    require("@tailwindcss/line-clamp"),
    require("tailwind-children"),
    require("tailwind-gradient-mask-image"),
    plugin(({ addVariant, addUtilities, addComponents }) => {
      addVariant("hfa", ["&:hover", "&:focus", "&:active"]);
      addVariant("hfva", ["&:hover", "&:focus", "&:focus-visible", "&:active"]);
      addVariant("ha", ["&:hover", "&:active"]);
      addVariant("hf", ["&:hover", "&:focus"]);
      addVariant("fa", ["&:focus", "&:active"]);
      addVariant("f", ["&:focus"]);
      addVariant("fw", ["&:focus-within"]);
      addVariant("h", ["&:hover"]);
      addVariant("d", [".dark &"]);
      addVariant("ac", ["&:active"]);
      addVariant("b", ["&::before"]);
      addVariant("a", ["&::after"]);
      addVariant("not-prose", [":not(.prose &)&"]);
      addVariant("hfaa", ["&:hover", "&:focus", "&:active, &.active"]);
      addVariant("hfvaa", ["&:hover", "&:focus", "&:focus-visible", "&:active, &.active"]);
      addVariant("group-hfa", [".group:hover &", ".group:focus &", ".group:active &"]);
      addVariant("selected", [".selected &", ".selected &", ".selected &"]);
      addVariant("peer-hfa", [".peer:hover ~ &", ".peer:focus ~ &", ".peer:active ~ &"]);
      addVariant("group-hfva", [
        ".group:hover &",
        ".group:focus &",
        ".group:focus-visible &",
        ".group:active &",
      ]);
      addUtilities({
        ".shape-geometric-precision": {
          "shape-rendering": "geometricPrecision",
        },
        ".open-quote": {
          content: "open-quote",
        },
        ".close-quote": {
          content: "close-quote",
        },
        ".leading-0": {
          "line-height": "0",
        },
        ".animation-pause": {
          "animation-play-state": "paused",
        },
      });
    }),
    ({ matchUtilities, theme }) => {
      matchUtilities(
        {
          "bg-grid": (value) => {
            if (/var\(--/gi.test(value)) {
              const color = value.replace(/var\(--color-([\w-]+\d+)\)/gi, (_, match) => {
                return hexToRgb(
                  colors[match.split("-")[0].replace(/^gray$/gi, "trueGray")][+match.split("-")[1]]
                );
              });
              return {
                backgroundImage: `url("${svgToDataUri(
                  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="${color}"><path d="M0 .5H31.5V32"/></svg>`
                )}")`,
              };
            }
            return {
              backgroundImage: `url("${svgToDataUri(
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="${value}"><path d="M0 .5H31.5V32"/></svg>`
              )}")`,
            };
          },
        },
        { values: flattenColorPalette(theme("backgroundColor")), type: "color" }
      );

      matchUtilities(
        {
          highlight: (value) => ({ boxShadow: `inset 0 1px 0 0 ${value}` }),
        },
        { values: flattenColorPalette(theme("backgroundColor")), type: "color" }
      );
      matchUtilities(
        {
          spacing: (value) => ({
            display: `flex`,
            flexDirection: "column",
            gap: value,
            "@media print": {
              display: `block`,
              "&>*:not(:first-child)": {
                marginTop: value,
              },
            },
          }),
        },
        { values: theme("spacing") }
      );
    },
    ({ addUtilities, theme }) => {
      const backgroundSize = "7.07px 7.07px";
      const backgroundImage = (color) =>
        `linear-gradient(135deg, ${color} 10%, transparent 10%, transparent 50%, ${color} 50%, ${color} 60%, transparent 60%, transparent 100%)`;
      const colors = Object.entries(theme("backgroundColor")).filter(
        ([, value]) => typeof value === "object" && value[400] && value[500]
      );

      addUtilities(
        Object.fromEntries(
          colors.map(([name, colors]) => {
            const backgroundColor = `${colors[400]}1a`; // 10% opacity
            const stripeColor = `${colors[500]}80`; // 50% opacity

            return [
              `.bg-stripes-${name}`,
              {
                backgroundColor,
                backgroundImage: backgroundImage(stripeColor),
                backgroundSize,
              },
            ];
          })
        )
      );

      addUtilities({
        ".bg-stripes-white": {
          backgroundImage: backgroundImage("rgba(255 255 255 / 0.75)"),
          backgroundSize,
        },
      });

      addUtilities({
        ".ligatures-none": {
          fontVariantLigatures: "none",
        },
      });
    },
  ],
};
