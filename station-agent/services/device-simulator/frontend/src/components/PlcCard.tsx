import type { PlcState } from '../types'
import DeviceStatusBadge from './DeviceStatusBadge'

interface Props { state: PlcState }

const REGISTER_LABELS: Record<string, string> = {
  START_BUTTON: 'Start',
  STOP_BUTTON: 'Stop',
  SENSOR_IN: 'Sensor IN',
  SENSOR_OUT: 'Sensor OUT',
  MACHINE_READY: 'Machine Ready'
}

export default function PlcCard({ state }: Props) {
  const toggleRegister = async (name: string, current: boolean) => {
    await fetch(`/api/plc/registers/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: !current })
    })
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚙</span>
          <div>
            <div className="font-semibold text-white">Virtual PLC</div>
            <div className="text-xs text-gray-500">Modbus TCP :{state.port}</div>
          </div>
        </div>
        <DeviceStatusBadge online={state.online} />
      </div>

      <div className="bg-gray-800 rounded p-2">
        <div className="text-xs text-gray-400 mb-2">Events: {state.eventCount}</div>
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

      {state.lastEventAt && (
        <div className="text-xs text-gray-500">
          Last event: {new Date(state.lastEventAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
