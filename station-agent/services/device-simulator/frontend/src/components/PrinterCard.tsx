import type { PrinterState, PrinterJob } from '../types'
import DeviceStatusBadge from './DeviceStatusBadge'

interface Props {
  state: PrinterState
  jobs: PrinterJob[]
}

export default function PrinterCard({ state, jobs }: Props) {
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🖨</span>
          <div>
            <div className="font-semibold text-white">Virtual Printer</div>
            <div className="text-xs text-gray-500">TCP :{state.port} · ZPL/EPL</div>
          </div>
        </div>
        <DeviceStatusBadge online={state.online} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-800 rounded p-2">
          <div className="text-gray-400">Jobs received</div>
          <div className="text-white font-mono text-lg">{state.jobCount}</div>
        </div>
        <div className="bg-gray-800 rounded p-2">
          <div className="text-gray-400">Last result</div>
          <div className={`font-medium ${state.lastResult === 'PRINTED' ? 'text-green-400' : state.lastResult === 'FAILED' ? 'text-red-400' : 'text-gray-500'}`}>
            {state.lastResult ?? '—'}
          </div>
        </div>
      </div>

      {state.lastZplPreview && (
        <div className="bg-gray-950 rounded p-2 text-xs font-mono text-gray-400 overflow-hidden max-h-16 leading-tight">
          {state.lastZplPreview}
        </div>
      )}

      {jobs.length > 0 && (
        <div className="space-y-1 max-h-32 overflow-auto">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Recent jobs</div>
          {jobs.slice(0, 5).map(j => (
            <div key={j.id} className="flex items-center justify-between text-xs">
              <span className={j.status === 'PRINTED' ? 'text-green-400' : 'text-red-400'}>{j.status}</span>
              <span className="text-gray-500">{j.durationMs}ms</span>
              <span className="text-gray-600">{new Date(j.receivedAt).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
