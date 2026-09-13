/**
 * Feature-boundary architecture shared by the production ESLint flat config
 * (`eslint.config.js`) and the executable Vitest probe
 * (`src/test/feature-boundaries.test.ts`).
 *
 * Each feature exposes exactly one public entry point (`src/features/<name>/index.ts`).
 * A file may import another feature only through that entry point — deep
 * cross-feature imports are rejected.
 */
export const boundariesPluginSettings = {
  'boundaries/elements': [
    { type: 'app', pattern: 'src/app', partialMatch: false },
    { type: 'shared', pattern: 'src/shared', partialMatch: false },
    {
      type: 'feature',
      pattern: 'src/features/*',
      partialMatch: false,
      capture: ['feature'],
    },
  ],
  'import/resolver': {
    typescript: {
      alwaysTryTypes: true,
      project: ['./tsconfig.app.json'],
    },
  },
}

export const boundaryRuleOptions = {
  default: 'allow',
  policies: [
    {
      // Deep imports are only forbidden when they leave the importing feature.
      // Dependencies internal to the same element are skipped by the rule.
      from: { element: { type: ['app', 'shared', 'feature'] } },
      disallow: {
        to: { element: { type: 'feature', fileInternalPath: '!index.ts' } },
      },
    },
  ],
}
