import { describe, expect, it } from 'vitest'

import { copy, formatCount } from './i18n'

describe('typed product copy', () => {
  it('selects the supported locale and keeps interpolated copy localized', () => {
    expect(copy('en').shell.assigned(2)).toBe('2 assigned people')
    expect(copy('fa').shell.assigned(2)).toBe('2 نفر در مراقبت')
    expect(copy('fa').medication.timingAcknowledgement(15)).toContain('۱۵')
    expect(copy('unsupported').shell.synced).toBe('Synced')
  })

  it('formats quick action count badges with Persian numerals when locale is fa', () => {
    expect(formatCount(3, 'en')).toBe('3×')
    expect(formatCount(3, 'fa')).toBe('۳×')
    expect(copy('en').quickActions.title).toBe('Quick Care Actions')
    expect(copy('fa').quickActions.title).toBe('اقدامات سریع و پرتکرار')
  })
})
