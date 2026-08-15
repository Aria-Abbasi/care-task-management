import type { TaskOccurrence } from './types'

export type ScheduleStatusFilter = 'all' | 'completed' | 'pending' | 'overdue'

export function filterScheduleOccurrences(items: TaskOccurrence[], filter: ScheduleStatusFilter) {
  if (filter === 'completed') return items.filter((item) => item.status === 'DONE')
  if (filter === 'pending') return items.filter((item) => ['PENDING', 'DELAYED'].includes(item.status))
  if (filter === 'overdue') return items.filter((item) => item.status === 'MISSED')
  return items
}
