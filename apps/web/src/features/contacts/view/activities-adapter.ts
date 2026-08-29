import type { StarterActivity } from '#lib/trpc/react'

import type { Activities } from './activity-timeline'

type TimelineUser = Activities[number]['user']

const metadataString = (
  metadata: StarterActivity['metadata'],
  key: string,
  fallback = '',
) => (typeof metadata?.[key] === 'string' ? metadata[key] : fallback)

export const toTimelineActivity = (
  activity: StarterActivity,
  user: TimelineUser = { id: 'system', name: 'System' },
): Activities[number] => {
  const common = {
    id: activity.id,
    user,
    date: activity.createdAt,
  }

  if (activity.type === 'comment-added' || activity.type === 'comment') {
    return {
      ...common,
      type: 'comment',
      data: { comment: metadataString(activity.metadata, 'comment') },
    }
  }

  if (activity.type === 'contact-created' || activity.type === 'action') {
    return {
      ...common,
      type: 'action',
      data: { action: metadataString(activity.metadata, 'action', 'created') },
    }
  }

  return {
    ...common,
    type: 'update',
    data: {
      field: metadataString(activity.metadata, 'field', 'contact'),
      oldValue: metadataString(activity.metadata, 'oldValue') || undefined,
      value: metadataString(activity.metadata, 'value') || undefined,
    },
  }
}
