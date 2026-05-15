import { useAtomValue, useSetAtom } from 'jotai'
import { dismissNotificationAtom, notificationsAtom } from '../state'
import { InlineAlert, Panel } from './ui'

export function NotificationCenter() {
  const notifications = useAtomValue(notificationsAtom)
  const dismissNotification = useSetAtom(dismissNotificationAtom)
  if (notifications.length === 0) return null
  return (
    <div className="grid gap-2">
      {notifications.map((notification) => (
        <InlineAlert
          key={notification.id}
          variant={notification.variant}
          onClose={() => dismissNotification(notification.id)}
        >
          {notification.message}
        </InlineAlert>
      ))}
    </div>
  )
}

export function AgentIntro() {
  return (
    <Panel className="grid gap-4">
      <div>
        <h2 className="text-xl font-bold">LC Agent</h2>
      </div>
    </Panel>
  )
}
