// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/generated/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Prisma's generated types intentionally use `any` in a few spots;
      // don't fight the generated code, only lint what we wrote by hand.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
