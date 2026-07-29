export type Locale = 'en' | 'fa'

/** Product-controlled shared copy only. Clinical/source content is never translated here. */
export const sharedCopy = {
  en: {
    loading: 'Loading…', retry: 'Try again', close: 'Close', save: 'Save changes', cancel: 'Cancel',
    unavailable: 'This information is temporarily unavailable.', offline: 'Working offline', synced: 'Synced',
    patientIdentity: 'Patient identity', room: 'Room', noResults: 'Nothing to show yet.',
  },
  fa: {
    loading: 'در حال بارگذاری…', retry: 'تلاش دوباره', close: 'بستن', save: 'ذخیره تغییرات', cancel: 'انصراف',
    unavailable: 'این اطلاعات موقتاً در دسترس نیست.', offline: 'کار آفلاین', synced: 'همگام است',
    patientIdentity: 'هویت بیمار', room: 'اتاق', noResults: 'هنوز موردی برای نمایش نیست.',
  },
} as const

export function copy(locale: string): Record<keyof typeof sharedCopy.en, string> {
  return sharedCopy[locale === 'fa' ? 'fa' : 'en']
}

export function localizedFallback(locale: string, error: unknown, englishFallback: string, persianFallback = 'انجام این درخواست ممکن نشد. دوباره تلاش کنید.') {
  if (locale !== 'fa') return error instanceof Error ? error.message : englishFallback
  return persianFallback
}
