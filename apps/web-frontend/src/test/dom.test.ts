import { describe, expect, it } from 'vitest'

import { resolveRootContainer } from '@/app/dom'

describe('resolveRootContainer', () => {
  it('returns the #root element when it exists', () => {
    document.body.innerHTML = '<div id="root"></div>'

    expect(resolveRootContainer()).toBe(document.getElementById('root'))
  })

  it('throws a descriptive error when #root is missing', () => {
    document.body.innerHTML = ''

    expect(() => resolveRootContainer()).toThrow('Unable to find the #root application container.')
  })
})
