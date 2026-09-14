/**
 * Named mock journey scenarios (issue #136 resolution, "Fixtures and named
 * scenarios"). Scenario selection is environment-only: it never comes from the
 * URL, and invalid values fail with the full valid list.
 */
export const mockScenarioNames = [
  'anonymous',
  'provisioning',
  'established-player',
  'damaged-ship',
  'expedition-ready',
  'active-expedition',
  'resolved-expedition',
  'expired-session',
  'service-outage',
  'delayed-propagation',
] as const

export type MockScenarioName = (typeof mockScenarioNames)[number]

/** `established-player` is the default for `npm run dev:mock`. */
export const defaultMockScenario: MockScenarioName = 'established-player'

export function isMockScenarioName(value: string): value is MockScenarioName {
  return (mockScenarioNames as readonly string[]).includes(value)
}

/**
 * Validates `VITE_MOCK_SCENARIO` at the environment trust boundary. An empty or
 * absent value selects the default; an unknown value is rejected with an
 * actionable message listing every valid name.
 */
export function parseMockScenario(value: string | undefined): MockScenarioName {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') {
    return defaultMockScenario
  }
  if (!isMockScenarioName(trimmed)) {
    throw new Error(
      `VITE_MOCK_SCENARIO must be one of: ${mockScenarioNames.join(', ')} (received ${JSON.stringify(value)})`,
    )
  }
  return trimmed
}
