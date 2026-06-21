import { useState, useEffect } from 'react'
import type { PlcState, ConfigValue } from '../types'
import DeviceStatusBadge from './DeviceStatusBadge'

interface Props {
  state: PlcState
  configValues: ConfigValue[]
  onSaveConfig: (key: string, value: string) => Promise<void>
}

const REGISTER_LABELS: Record<string, string> = {
  START_BUTTON: 'Start',
  STOP_BUTTON: 'Stop',
  SENSOR_IN: 'Sensor IN',
  SENSOR_OUT: 'Sensor OUT',
  MACHINE_READY: 'Machine Ready'
}

export default function PlcCard({ state, configValues, onSaveConfig }: Props) {
  const [showConfig, setShowConfig] = useState(false)
  const failureRate = configValues.find(c => c.key === 'PLC_FAILURE_RATE')?.value ?? '0'
  const portConfig = configValues.find(c => c.key === 'PLC_MODBUS_PORT')?.value ?? '5020'

  const [draftFailureRate, setDraftFailureRate] = useState(failureRate)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraftFailureRate(failureRate)
  }, [failureRate])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveConfig('PLC_FAILURE_RATE', draftFailureRate)
      setShowConfig(false)
    } finally {
      setSaving(false)
    }
  }

  const toggleRegister = async (name: string, current: boolean) => {
    await fetch(`/api/plc/registers/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: !current })
    })
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3 flex flex-col justify-between">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚙</span>
            <div>
              <div className="font-semibold text-white">Virtual PLC</div>
              <div className="text-xs text-gray-500">Modbus TCP :{state.port}</div>
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
              <span className="text-[10px] text-gray-500 font-mono">Modbus TCP</span>
            </div>
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-400">Port (PLC_MODBUS_PORT)</span>
                <span className="font-mono text-gray-500">{portConfig} (Read-only)</span>
              </div>
              <div>
                <label className="block text-gray-400 text-[10px] mb-1">Command Failure Rate (PLC_FAILURE_RATE %)</label>
                <input type="number" min="0" max="100" value={draftFailureRate} onChange={e => setDraftFailureRate(e.target.value)}
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
            <div className="bg-gray-800 rounded p-2">
              <div className="text-xs text-gray-400 mb-2 font-semibold">Registers</div>
              <div className="space-y-2">
                {Object.entries(state.registers).map(([name, value]) => (
                  <div key={name} className="flex items-center justify-between">
                    <span className="text-xs text-gray-300">{REGISTER_LABELS[name] ?? name}</span>
                    <button
                      onClick={() => toggleRegister(name, value)}
                      className={`relative inline-flex h-5 w-9 rounded-full transition-colors focus:outline-none
                        ${value ? 'bg-green-600' : 'bg-gray-600'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5
                        ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {!showConfig && (
        <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-800 mt-2">
          <span>Events: <span className="font-mono text-gray-400">{state.eventCount}</span></span>
          {state.lastEventAt && (
            <span>Last: {new Date(state.lastEventAt).toLocaleTimeString()}</span>
          )}
        </div>
      )}
    </div>
  )
}
