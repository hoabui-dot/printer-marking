import type { TimelineEvent } from '../types'

interface Props { events: TimelineEvent[] }

const STAGE_ICON: Record<string, string> = {
  GATEWAY_PUBLISHED: '📡',
  MQTT_RECEIVED: '📨',
  LINE_LOGIC_STARTED: '⚡',
  PRINTER_EXECUTED: '🖨',
  LASER_EXECUTED: '⚡',
  VISION_VERIFIED: '📷',
  PLC_UPDATED: '⚙',
}

const STATUS_COLOR: Record<string, string> = {
  OK: 'border-green-800 bg-green-900/20',
  FAILED: 'border-red-800 bg-red-900/20',
  INFO: 'border-blue-800 bg-blue-900/20',
}

export default function TimelinePanel({ events }: Props) {
  return (
    <div className="space-y-1 max-h-[600px] overflow-auto pr-1">
      {events.length === 0 && (
        <div className="text-gray-600 text-xs text-center py-8">
          No events yet — virtual devices will push events here as they process requests
        </div>
      )}
      {events.map(evt => (
        <div key={evt.id}
          className={`flex gap-3 items-start p-2 rounded border text-xs ${STATUS_COLOR[evt.status] ?? 'border-gray-800 bg-gray-900/20'}`}>
          <span className="text-sm shrink-0">{STAGE_ICON[evt.stage] ?? '●'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-gray-200">{evt.stage.replace(/_/g, ' ')}</span>
              <span className={`shrink-0 ${evt.status === 'OK' ? 'text-green-400' : evt.status === 'FAILED' ? 'text-red-400' : 'text-blue-400'}`}>
                {evt.status}
              </span>
            </div>
            <div className="text-gray-400 truncate">{evt.detail}</div>
          </div>
          <span className="text-gray-600 shrink-0 whitespace-nowrap">
            {new Date(evt.occurredAt).toLocaleTimeString()}
          </span>
        </div>
      ))}
    </div>
  )
}
