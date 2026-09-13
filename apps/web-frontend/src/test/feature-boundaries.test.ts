import { ESLint } from 'eslint'
import boundaries from 'eslint-plugin-boundaries'
import { parser as tsParser } from 'typescript-eslint'
import { describe, expect, it } from 'vitest'

import { boundaryRuleOptions, boundariesPluginSettings } from '../../eslint.boundaries.js'

const projectRoot = process.cwd()

/**
 * Lints a synthetic source as if it lived in `features/ship`. This uses the
 * same boundary settings and policies as the production flat config, without
 * type-aware parsing, so the architecture rule can be asserted in isolation.
 */
async function collectBoundaryErrors(source: string): Promise<string[]> {
  const eslint = new ESLint({
    cwd: projectRoot,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: tsParser,
          parserOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            ecmaFeatures: { jsx: true },
          },
        },
        plugins: { boundaries },
        settings: {
          ...boundariesPluginSettings,
          'boundaries/root-path': projectRoot,
        },
        rules: {
          'boundaries/dependencies': ['error', boundaryRuleOptions],
        },
      },
    ],
  })

  const results = await eslint.lintText(source, {
    filePath: `${projectRoot}/src/features/ship/__boundary_probe__.ts`,
  })

  return results.flatMap((result) =>
    result.messages
      .filter((message) => message.ruleId === 'boundaries/dependencies')
      .map((message) => message.message),
  )
}

describe('feature boundary rule', () => {
  it('rejects a cross-feature deep import', async () => {
    const errors = await collectBoundaryErrors(
      "import { DailiesListPage } from '@/features/dailies/pages/DailiesListPage'\n",
    )

    expect(errors).not.toHaveLength(0)
    expect(errors.join('\n')).toMatch(/not allowed/i)
  })

  it('allows importing a feature through its public entry point', async () => {
    const errors = await collectBoundaryErrors(
      "import { DailiesListPage } from '@/features/dailies'\n",
    )

    expect(errors).toHaveLength(0)
  })
})
