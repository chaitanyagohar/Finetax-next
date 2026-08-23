import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: "#10233f",
        accent: "#b8860b",
        surface: "#ffffff",
        textMain: "#1f2937",
        border: "#e5e7eb",
      }
    },
  },
  plugins: [],
};
export default config;