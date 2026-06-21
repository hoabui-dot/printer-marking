import { useState, useEffect } from 'react'
import type { LaserState, LaserCommand, ConfigValue } from '../types'
import DeviceStatusBadge from './DeviceStatusBadge'

interface Props {
  state: LaserState
  commands: LaserCommand[]
  configValues: ConfigValue[]
  onSaveConfig: (key: string, value: string) => Promise<void>
}

export default function LaserCard({ state, commands, configValues, onSaveConfig }: Props) {
  const [showConfig, setShowConfig] = useState(false)
  const failureRate = configValues.find(c => c.key === 'LASER_FAILURE_RATE')?.value ?? '3'
  const delayMs = configValues.find(c => c.key === 'LASER_DELAY_MS')?.value ?? '2000'
  const portConfig = configValues.find(c => c.key === 'LASER_TCP_PORT')?.value ?? '8901'

  const [draftFailureRate, setDraftFailureRate] = useState(failureRate)
  const [draftDelayMs, setDraftDelayMs] = useState(delayMs)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraftFailureRate(failureRate)
  }, [failureRate])

  useEffect(() => {
    setDraftDelayMs(delayMs)
  }, [delayMs])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveConfig('LASER_FAILURE_RATE', draftFailureRate)
      await onSaveConfig('LASER_DELAY_MS', draftDelayMs)
      setShowConfig(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3 flex flex-col justify-between">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚡</span>
            <div>
              <div className="font-semibold text-white">Virtual Laser</div>
              <div className="text-xs text-gray-500">TCP :{state.port} · MARK protocol</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowConfig(!showConfig)}
              className="text-gray-400 hover:text-white transition-colors text-[10px] bg-gray-800 hover:bg-gray-700 px-1.5 py-0.5 rounded font-mono">
              {showConfig ? '✕ Close' : '⚙️ Config'}
            </button>
            <DeviceStatusBadge online={state.online} />
          </div>
        </div>

        {showConfig ? (
          <div className="bg-gray-850 border border-gray-700 rounded p-3 space-y-2 text-xs">
            <div className="font-semibold text-gray-300 border-b border-gray-750 pb-1 flex justify-between">
              <span>Localhost Config Env</span>
              <span className="text-[10px] text-gray-500 font-mono">localhost:{state.port}</span>
            </div>
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-400">Port (LASER_TCP_PORT)</span>
                <span className="font-mono text-gray-500">{portConfig} (Read-only)</span>
              </div>
              <div>
                <label className="block text-gray-400 text-[10px] mb-1">Failure Rate (LASER_FAILURE_RATE %)</label>
                <input type="number" min="0" max="100" value={draftFailureRate} onChange={e => setDraftFailureRate(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 font-mono text-white text-xs" />
              </div>
              <div>
                <label className="block text-gray-400 text-[10px] mb-1">Processing Delay (LASER_DELAY_MS)</label>
                <input type="number" min="0" value={draftDelayMs} onChange={e => setDraftDelayMs(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 font-mono text-white text-xs" />
              </div>
              <button onClick={handleSave} disabled={saving}
                className="w-full bg-blue-700 hover:bg-blue-600 text-white rounded py-1 text-center font-medium disabled:opacity-50 transition-colors text-xs">
                {saving ? 'Saving...' : 'Save Direct Config'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-800 rounded p-2">
                <div className="text-gray-400">Commands</div>
                <div className="text-white font-mono text-lg">{state.commandCount}</div>
              </div>
              <div className="bg-gray-800 rounded p-2">
                <div className="text-gray-400">Last result</div>
                <div className={`font-medium ${state.lastResult === 'SUCCESS' ? 'text-green-400' : state.lastResult === 'FAILED' ? 'text-red-400' : 'text-gray-500'}`}>
                  {state.lastResult ?? '—'}
                </div>
              </div>
            </div>

            {state.lastCommand && (
              <div className="text-xs text-gray-400 bg-gray-800 rounded p-2 font-mono truncate">
                {state.lastCommand}
              </div>
            )}
          </>
        )}
      </div>

      {!showConfig && commands.length > 0 && (
        <div className="space-y-1 max-h-32 overflow-auto pt-2 border-t border-gray-800 mt-2">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide">Recent</div>
          {commands.slice(0, 5).map(c => (
            <div key={c.id} className="flex items-center justify-between text-xs">
              <span className="text-gray-300 truncate max-w-24">{c.rawCommand}</span>
              <span className={c.status === 'SUCCESS' ? 'text-green-400' : 'text-red-400'}>{c.status}</span>
              <span className="text-gray-500">{c.durationMs}ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
