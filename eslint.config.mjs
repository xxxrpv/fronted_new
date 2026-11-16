import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["node_modules/**", ".next/**", ".pnpm-store/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["scripts/*.mjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
