import type { DeviceLog } from '../types'

interface Props {
  logs: DeviceLog[]
}

export default function LogsTable({ logs }: Props) {
  return (
    <div className="overflow-auto max-h-96 border border-gray-700 rounded-lg">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-gray-900">
          <tr className="text-gray-400 border-b border-gray-700">
            <th className="text-left px-3 py-2">Time</th>
            <th className="text-left px-3 py-2">Device</th>
            <th className="text-left px-3 py-2">Dir</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-left px-3 py-2 w-40">Payload (truncated)</th>
            <th className="text-right px-3 py-2">ms</th>
          </tr>
        </thead>
        <tbody>
          {logs.map(log => (
            <tr key={log.id} className="border-b border-gray-800 hover:bg-gray-800/40">
              <td className="px-3 py-1 text-gray-400 whitespace-nowrap">
                {new Date(log.timestamp).toLocaleTimeString()}
              </td>
              <td className="px-3 py-1 text-gray-300">{log.deviceName}</td>
              <td className="px-3 py-1">
                <span className={`px-1 rounded ${log.direction === 'INBOUND' ? 'text-blue-400' : 'text-purple-400'}`}>
                  {log.direction === 'INBOUND' ? '↓ IN' : '↑ OUT'}
                </span>
              </td>
              <td className="px-3 py-1">
                {log.success === null ? (
                  <span className="text-gray-500">—</span>
                ) : log.success ? (
                  <span className="text-green-400">OK</span>
                ) : (
                  <span className="text-red-400">FAIL</span>
                )}
              </td>
              <td className="px-3 py-1 text-gray-500 max-w-xs truncate">
                {log.payload.slice(0, 80)}
              </td>
              <td className="px-3 py-1 text-right text-gray-400">
                {log.durationMs ?? '—'}
              </td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-8 text-center text-gray-600">No logs yet</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
