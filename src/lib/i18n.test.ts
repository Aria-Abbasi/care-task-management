import { describe, expect, it } from 'vitest'

import { copy } from './i18n'

describe('typed product copy', () => {
  it('selects the supported locale and keeps interpolated copy localized', () => {
    expect(copy('en').shell.assigned(2)).toBe('2 assigned people')
    expect(copy('fa').shell.assigned(2)).toBe('2 نفر در مراقبت')
    expect(copy('fa').medication.timingAcknowledgement(15)).toContain('۱۵')
    expect(copy('unsupported').shell.synced).toBe('Synced')
  })
})
