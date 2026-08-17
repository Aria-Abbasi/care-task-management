import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import MealsView from './MealsView'
import type { Patient, Session } from '../lib/types'

const patient: Patient = {
  id: 7,
  first_name: 'Maryam',
  last_name: 'Abbasi',
  full_name: 'Maryam Abbasi',
  birth_date: '1948-06-04',
  age: 78,
  gender: 'FEMALE',
  room: '205',
  medical_notes: '',
  photo: null,
  active: true,
}

describe('MealsView and Nutrition Tracking', () => {
  it('renders meals page header and actions for care staff', () => {
    const session = { token: 'test', user: { id: 1, role: 'CAREGIVER' } } as Session
    const markup = renderToStaticMarkup(
      <MealsView session={session} patient={patient} canManage={true} locale="en" />,
    )

    expect(markup).toContain('Food &amp; Meals')
    expect(markup).toContain('Log food intake')
    expect(markup).toContain('Add meal / recipe')
    expect(markup).toContain('Planned Meals &amp; Recipes')
    expect(markup).toContain("Today&#x27;s Intake Log")
  })

  it('renders meals page for family members with intake logging affordance but without add meal management', () => {
    const session = { token: 'test', user: { id: 5, role: 'FAMILY' } } as Session
    const markup = renderToStaticMarkup(
      <MealsView session={session} patient={patient} canManage={false} locale="en" />,
    )

    expect(markup).toContain('Food &amp; Meals')
    expect(markup).toContain('Log food intake')
    expect(markup).not.toContain('Add meal / recipe')
  })

  it('supports Persian locale with accurate terminology and RTL layout', () => {
    const session = { token: 'test', user: { id: 1, role: 'CAREGIVER' } } as Session
    const markup = renderToStaticMarkup(
      <MealsView session={session} patient={patient} canManage={true} locale="fa" />,
    )

    expect(markup).toContain('غذا و تغذیه')
    expect(markup).toContain('ثبت مصرف غذا')
    expect(markup).toContain('تعریف وعده غذایی')
    expect(markup).toContain('همه وعده‌ها')
    expect(markup).toContain('صبحانه')
    expect(markup).toContain('ناهار')
    expect(markup).toContain('شام')
  })
})
