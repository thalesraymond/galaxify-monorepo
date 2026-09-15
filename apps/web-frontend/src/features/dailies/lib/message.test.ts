import { describe, expect, it } from 'vitest'

import { requestFailureMessage } from './message'

describe('requestFailureMessage', () => {
  it('prefers the backend message for HTTP errors', () => {
    expect(
      requestFailureMessage(
        {
          kind: 'api',
          status: 500,
          requestId: 'req-1',
          code: 'INTERNAL_ERROR',
          message: 'Completion exploded.',
          fieldErrors: undefined,
        },
        'Fallback.',
      ),
    ).toBe('Completion exploded.')
  })

  it('explains network failures', () => {
    expect(
      requestFailureMessage(
        { kind: 'network', requestId: 'req-1', cause: new Error('down') },
        'Fallback.',
      ),
    ).toBe('Could not reach the service. Try again.')
  })

  it('uses the caller fallback for anything else', () => {
    expect(requestFailureMessage(new Error('unexpected'), 'The Daily could not be deleted.')).toBe(
      'The Daily could not be deleted.',
    )
    expect(requestFailureMessage('plain string', 'Fallback.')).toBe('Fallback.')
  })
})
