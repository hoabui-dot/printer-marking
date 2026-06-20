import {
  useSimulator, usePrinterJobs, useLaserCommands,
  useVisionResults, usePlcState, useGatewayEvents, useConnections
} from './hooks/useSimulator'
import PrinterCard from './components/PrinterCard'
import LaserCard from './components/LaserCard'
import VisionCard from './components/VisionCard'
import PlcCard from './components/PlcCard'
import GatewayCard from './components/GatewayCard'
import TimelinePanel from './components/TimelinePanel'
import ConnectionPanel from './components/ConnectionPanel'
import EnvPanel from './components/EnvPanel'
import { useState } from 'react'

type Tab = 'devices' | 'timeline' | 'env'

export default function App() {
  const { status, timeline, connected } = useSimulator()
  const printerJobs = usePrinterJobs()
  const laserCmds = useLaserCommands()
  const visionResults = useVisionResults()
  const gatewayEvents = useGatewayEvents()
  const connections = useConnections()
  const [tab, setTab] = useState<Tab>('devices')

  return (
    <div className="min-h-screen p-4">
      {/* Header */}
      <header className="flex items-center justify-between mb-5 pb-4 border-b border-gray-800">
        <div>
          <h1 className="text-xl font-bold text-white">Device Simulator</h1>
          <p className="text-xs text-gray-500">Virtual factory environment — 5 devices auto-running</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-gray-400">{connected ? 'SignalR Live' : 'Disconnected'}</span>
          </div>
          {status && (
            <div className="flex gap-1">
              {[
                { label: 'PRT', on: status.printer.online },
                { label: 'LSR', on: status.laser.online },
                { label: 'VIS', on: status.vision.online },
                { label: 'PLC', on: status.plc.online },
                { label: 'GW', on: status.gateway.connected },
              ].map(d => (
                <span key={d.label} className={`px-1.5 py-0.5 rounded text-xs font-mono
                  ${d.on ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                  {d.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="flex gap-4">
        {/* Sidebar */}
        <aside className="w-56 shrink-0 space-y-4">
          <ConnectionPanel connections={connections} />
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0">
          {/* Tabs */}
          <div className="flex gap-1 mb-4 border-b border-gray-800">
            {(['devices', 'timeline', 'env'] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-1.5 text-sm rounded-t capitalize transition-colors
                  ${tab === t ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                {t === 'timeline' ? `Timeline (${timeline.length})` : t === 'devices' ? 'Devices' : 'Environment'}
              </button>
            ))}
          </div>

          {tab === 'devices' && status && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              <PrinterCard state={status.printer} jobs={printerJobs} />
              <LaserCard state={status.laser} commands={laserCmds} />
              <VisionCard state={status.vision} results={visionResults} />
              <PlcCard state={status.plc} />
              <GatewayCard state={status.gateway} events={gatewayEvents} />
            </div>
          )}

          {tab === 'devices' && !status && (
            <div className="flex items-center justify-center h-48 text-gray-600">
              Connecting to virtual devices…
            </div>
          )}

          {tab === 'timeline' && (
            <div>
              <div className="text-xs text-gray-500 mb-3">
                Live event stream from all virtual devices — showing last {timeline.length} events
              </div>
              <TimelinePanel events={timeline} />
            </div>
          )}

          {tab === 'env' && (
            <div className="max-w-2xl">
              <EnvPanel />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
