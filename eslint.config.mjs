// @ts-check
/**
 * ESLint flat config for Workspace's component templates.
 *
 * Only templates are linted: the `.html` files and the templates written inline in
 * components, which the processor below extracts. TypeScript is parsed solely to find those
 * inline templates. The accessibility rules catch what a template can state wrongly on its
 * own: a label tied to nothing, a click with no key, a handler on something focus cannot
 * reach. A deliberate exception is disabled on its line with the reason beside it.
 *
 * `.mjs` rather than `.js` because package.json declares no `type`, so a bare `.js` would be
 * parsed as CommonJS and these imports would fail.
 */
import tseslint from "typescript-eslint";
import angular from "angular-eslint";

export default tseslint.config(
  {
    ignores: [".angular/**", ".workspace-build/**", "app/**", "browser/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    processor: angular.processInlineTemplates,
  },
  {
    files: ["src/**/*.html"],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
  },
);
