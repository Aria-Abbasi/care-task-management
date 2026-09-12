export type Locale = 'en' | 'fa'

type TranslateShape<T> = T extends (...args: infer Args) => unknown
  ? (...args: Args) => string
  : T extends object
    ? { [Key in keyof T]: TranslateShape<T[Key]> }
    : string

const english = {
  common: {
    loading: 'Loading…', retry: 'Try again', close: 'Close', save: 'Save changes', cancel: 'Cancel',
    unavailable: 'This information is temporarily unavailable.', offline: 'Working offline', synced: 'Synced',
    patientIdentity: 'Patient identity', room: 'Room', noResults: 'Nothing to show yet.',
  },
  shell: {
    skip: 'Skip to care workspace', closeMenu: 'Close menu', openMenu: 'Open menu',
    assigned: (count: number) => `${count} assigned ${count === 1 ? 'person' : 'people'}`,
    selectPatient: 'Select person receiving care', room: (value: string) => `Room ${value}`,
    age: (value: number) => `${value} years old`, workspace: 'CARE WORKSPACE', careOf: (name: string) => `${name}'s care`,
    syncing: 'Syncing', offline: 'Offline', pending: (count: number) => `${count} pending`, synced: 'Synced',
    pendingTitle: (count: number) => `${count} pending changes`, offlineTitle: 'Working offline', search: 'Search',
    unread: (count: number) => `${count} unread notifications`, more: 'More',
    searchLabel: 'Search care workspace', searchEyebrow: 'GLOBAL SEARCH', searchTitle: 'Find care information',
    searchPlaceholder: 'Search tasks and workspace sections', workspaceSection: 'Workspace section',
    syncAnnouncement: 'Synchronizing care records', pendingAnnouncement: (count: number) => `${count} changes need synchronization`,
    syncedAnnouncement: 'Care records synchronized', account: 'Account', settings: 'Workspace settings',
    switchPatient: 'Switch person receiving care', signOut: 'Sign out', protectedSignOut: 'Sync offline changes before signing out',
    role: { CAREGIVER: 'Caregiver', DOCTOR: 'Clinician', FAMILY: 'Family member', ADMIN: 'Administrator' },
  },
  shift: {
    eyebrow: 'RAPID CAREGIVER MODE', title: 'My shift', description: 'Due care and rapid recording with patient identity always visible.',
    patient: 'Current patient', room: 'Room', offline: 'Working offline', synced: 'Synced', pending: 'pending changes',
    due: 'Due now & overdue', medications: 'Medication verification', upcoming: 'Up next', record: 'Record safely',
    verify: 'Verify dose', none: 'Nothing is due right now', noneDetail: 'Upcoming work is shown below.',
    noMedication: 'No dose needs verification',
  },
  medication: {
    scheduled: 'scheduled', given: 'given', missed: 'missed', refused: 'refused', held: 'held',
    timingWindow: (minutes: number) => `${minutes}-minute window`,
    timingAcknowledgement: (minutes: number) => `I confirm this dose is being recorded outside the ${minutes}-minute window and the scheduled time will remain unchanged.`,
  },
  quickActions: {
    title: 'Quick Care Actions',
    subtitle: 'Standardized unscheduled care',
    customAction: 'Custom care action',
    actionLogged: (title: string) => `Logged: ${title}`,
    undo: 'Undo',
    undone: 'Care action undone',
    countBadge: (count: number) => `${count}×`,
    dismiss: 'Dismiss',
    pinAsQuickAction: 'Save as Pinned Quick Action on Today Dashboard',
    actionNoteRequiredTitle: 'Clinical Note Required',
    actionNoteRequiredDesc: 'This action requires a clinical note before it can be recorded.',
    notePlaceholder: 'Describe observations, care provided, or patient response...',
    completeWithNote: 'Complete & Log Action',
  },
} as const

const persian: TranslateShape<typeof english> = {
  common: {
    loading: 'در حال بارگذاری…', retry: 'تلاش دوباره', close: 'بستن', save: 'ذخیره تغییرات', cancel: 'انصراف',
    unavailable: 'این اطلاعات موقتاً در دسترس نیست.', offline: 'کار آفلاین', synced: 'همگام است',
    patientIdentity: 'هویت بیمار', room: 'اتاق', noResults: 'هنوز موردی برای نمایش نیست.',
  },
  shell: {
    skip: 'پرش به فضای کاری مراقبت', closeMenu: 'بستن منو', openMenu: 'باز کردن منو',
    assigned: (count) => `${count} نفر در مراقبت`, selectPatient: 'انتخاب فرد تحت مراقبت', room: (value) => `اتاق ${value}`,
    age: (value) => `${value} ساله`, workspace: 'فضای کاری مراقبت', careOf: (name) => `مراقبت ${name}`,
    syncing: 'در حال همگام‌سازی', offline: 'آفلاین', pending: (count) => `${count} مورد در انتظار`, synced: 'همگام است',
    pendingTitle: (count) => `${count} تغییر در انتظار`, offlineTitle: 'در حال کار آفلاین', search: 'جستجو',
    unread: (count) => `${count} اعلان خوانده‌نشده`, more: 'بیشتر',
    searchLabel: 'جستجوی فضای کاری مراقبت', searchEyebrow: 'جستجوی سراسری', searchTitle: 'یافتن اطلاعات مراقبت',
    searchPlaceholder: 'جستجوی وظایف و بخش‌های فضای کاری', workspaceSection: 'بخش فضای کاری',
    syncAnnouncement: 'در حال همگام‌سازی پرونده‌های مراقبتی', pendingAnnouncement: (count) => `${count} تغییر نیاز به همگام‌سازی دارد`,
    syncedAnnouncement: 'پرونده‌های مراقبتی همگام هستند', account: 'حساب کاربری', settings: 'تنظیمات فضای کاری',
    switchPatient: 'تغییر فرد تحت مراقبت', signOut: 'خروج از حساب', protectedSignOut: 'ابتدا تغییرات آفلاین را همگام‌سازی کنید',
    role: { CAREGIVER: 'مراقب', DOCTOR: 'پزشک', FAMILY: 'خانواده', ADMIN: 'مدیر' },
  },
  shift: {
    eyebrow: 'حالت سریع مراقب', title: 'شیفت من', description: 'مراقبت‌های سررسید و ثبت سریع با هویت بیمار همیشه قابل مشاهده.',
    patient: 'بیمار فعلی', room: 'اتاق', offline: 'کار آفلاین', synced: 'همگام است', pending: 'تغییر در انتظار',
    due: 'اکنون و گذشته', medications: 'بررسی دارو', upcoming: 'بعدی', record: 'ثبت ایمن', verify: 'بررسی دوز',
    none: 'مورد سررسیدشده‌ای نیست', noneDetail: 'فعالیت‌های بعدی در پایین نمایش داده می‌شوند.', noMedication: 'داروی نیازمند بررسی نیست',
  },
  medication: {
    scheduled: 'برنامه‌ریزی‌شده', given: 'داده شد', missed: 'انجام نشد', refused: 'رد شد', held: 'نگه‌داشته شد',
    timingWindow: (minutes) => `بازه ${new Intl.NumberFormat('fa-IR').format(minutes)} دقیقه‌ای`,
    timingAcknowledgement: (minutes) => `تأیید می‌کنم دوز خارج از بازه ${new Intl.NumberFormat('fa-IR').format(minutes)} دقیقه‌ای ثبت می‌شود و زمان برنامه‌ریزی‌شده تغییر نخواهد کرد.`,
  },
  quickActions: {
    title: 'اقدامات سریع و پرتکرار',
    subtitle: 'مراقبت‌های استاندارد بدون برنامه',
    customAction: 'اقدام مراقبتی سفارشی',
    actionLogged: (title) => `ثبت شد: ${title}`,
    undo: 'لغو / بازگردانی',
    undone: 'اقدام مراقبتی بازگردانده شد',
    countBadge: (count) => `${new Intl.NumberFormat('fa-IR').format(count)}×`,
    dismiss: 'بستن',
    pinAsQuickAction: 'ذخیره به عنوان اقدام سریع در صفحه امروز',
    actionNoteRequiredTitle: 'ثبت یادداشت بالینی الزامی است',
    actionNoteRequiredDesc: 'برای ثبت این اقدام، نوشتن توضیحات و مشاهدات بالینی الزامی است.',
    notePlaceholder: 'مشاهدات، مراقبت انجام‌شده یا وضعیت بیمار را شرح دهید...',
    completeWithNote: 'ثبت و تایید اقدام',
  },
}

export const productCopy = { en: english, fa: persian } as const
export type ProductCopy = TranslateShape<typeof english>

export function copy(locale: string): ProductCopy {
  return productCopy[locale === 'fa' ? 'fa' : 'en']
}

/** Stable shared-component subset. */
export const sharedCopy = { en: productCopy.en.common, fa: productCopy.fa.common } as const

export function localizedFallback(locale: string, error: unknown, englishFallback: string, persianFallback = 'انجام این درخواست ممکن نشد. دوباره تلاش کنید.') {
  if (locale !== 'fa') return error instanceof Error ? error.message : englishFallback
  return persianFallback
}

export function formatCount(count: number, locale: string): string {
  if (locale === 'fa') {
    return `${new Intl.NumberFormat('fa-IR').format(count)}×`
  }
  return `${count}×`
}

