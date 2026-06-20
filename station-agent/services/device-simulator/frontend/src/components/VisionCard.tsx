import { useState } from 'react'
import type { VisionState, VisionResult } from '../types'
import DeviceStatusBadge from './DeviceStatusBadge'

interface Props { state: VisionState; results: VisionResult[] }

export default function VisionCard({ state, results }: Props) {
  const [jobId, setJobId] = useState(`job-${Date.now()}`)
  const [verifying, setVerifying] = useState(false)
  const [lastResult, setLastResult] = useState<VisionResult | null>(null)

  const handleVerify = async () => {
    setVerifying(true)
    try {
      const r = await fetch('/api/vision/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId })
      })
      const data: VisionResult = await r.json()
      setLastResult(data)
      setJobId(`job-${Date.now()}`)
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">📷</span>
          <div>
            <div className="font-semibold text-white">Virtual Vision</div>
            <div className="text-xs text-gray-500">OCR / Barcode inspection</div>
          </div>
        </div>
        <DeviceStatusBadge online={state.online} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-gray-800 rounded p-2">
          <div className="text-gray-400">Requests</div>
          <div className="text-white font-mono">{state.requestCount}</div>
        </div>
        <div className="bg-gray-800 rounded p-2">
          <div className="text-gray-400">Pass rate</div>
          <div className="text-green-400 font-medium">{state.passRate}%</div>
        </div>
        <div className="bg-gray-800 rounded p-2">
          <div className="text-gray-400">Fail rate</div>
          <div className="text-red-400 font-medium">{state.failureRate}%</div>
        </div>
      </div>

      {lastResult && (
        <div className={`text-xs rounded p-2 ${lastResult.result === 'PASS' ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'}`}>
          <span className="font-semibold">{lastResult.result}</span>
          {lastResult.defectCode && <span className="ml-2 text-red-400">({lastResult.defectCode})</span>}
          {lastResult.ocrText && <span className="ml-2 text-gray-300">OCR: {lastResult.ocrText}</span>}
          {lastResult.confidence !== null && <span className="ml-2 text-gray-400">{(lastResult.confidence * 100).toFixed(1)}%</span>}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={jobId}
          onChange={e => setJobId(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs font-mono"
          placeholder="Job ID"
        />
        <button
          onClick={handleVerify}
          disabled={verifying}
          className="bg-blue-700 hover:bg-blue-600 text-white rounded px-3 py-1 text-xs disabled:opacity-50"
        >
          {verifying ? 'Verifying…' : 'Verify'}
        </button>
      </div>

      {results.length > 0 && (
        <div className="space-y-1 max-h-24 overflow-auto">
          {results.slice(0, 4).map(r => (
            <div key={r.id} className="flex items-center justify-between text-xs">
              <span className="text-gray-400 font-mono truncate max-w-20">{r.jobId}</span>
              <span className={r.result === 'PASS' ? 'text-green-400' : 'text-red-400'}>{r.result}</span>
              {r.defectCode && <span className="text-orange-400">{r.defectCode}</span>}
              <span className="text-gray-500">{r.durationMs}ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
