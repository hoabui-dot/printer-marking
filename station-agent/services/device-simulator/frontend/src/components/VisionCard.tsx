import { useState, useEffect } from 'react'
import type { VisionState, VisionResult, ConfigValue } from '../types'
import DeviceStatusBadge from './DeviceStatusBadge'

interface Props {
  state: VisionState
  results: VisionResult[]
  configValues: ConfigValue[]
  onSaveConfig: (key: string, value: string) => Promise<void>
}

export default function VisionCard({ state, results, configValues, onSaveConfig }: Props) {
  const [jobId, setJobId] = useState(`job-${Date.now()}`)
  const [verifying, setVerifying] = useState(false)
  const [lastResult, setLastResult] = useState<VisionResult | null>(null)
  
  const [showConfig, setShowConfig] = useState(false)
  const passRate = configValues.find(c => c.key === 'VISION_PASS_RATE')?.value ?? '95'
  const failureRate = configValues.find(c => c.key === 'VISION_FAILURE_RATE')?.value ?? '0'
  const delayMs = configValues.find(c => c.key === 'VISION_DELAY_MS')?.value ?? '500'

  const [draftPassRate, setDraftPassRate] = useState(passRate)
  const [draftFailureRate, setDraftFailureRate] = useState(failureRate)
  const [draftDelayMs, setDraftDelayMs] = useState(delayMs)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraftPassRate(passRate)
  }, [passRate])

  useEffect(() => {
    setDraftFailureRate(failureRate)
  }, [failureRate])

  useEffect(() => {
    setDraftDelayMs(delayMs)
  }, [delayMs])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveConfig('VISION_PASS_RATE', draftPassRate)
      await onSaveConfig('VISION_FAILURE_RATE', draftFailureRate)
      await onSaveConfig('VISION_DELAY_MS', draftDelayMs)
      setShowConfig(false)
    } finally {
      setSaving(false)
    }
  }

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
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3 flex flex-col justify-between">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📷</span>
            <div>
              <div className="font-semibold text-white">Virtual Vision</div>
              <div className="text-xs text-gray-500">OCR / Barcode inspection</div>
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
              <span className="text-[10px] text-gray-500 font-mono">Virtual Vision</span>
            </div>
            <div className="space-y-2 pt-1">
              <div>
                <label className="block text-gray-400 text-[10px] mb-1">Pass Rate (VISION_PASS_RATE %)</label>
                <input type="number" min="0" max="100" value={draftPassRate} onChange={e => setDraftPassRate(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 font-mono text-white text-xs" />
              </div>
              <div>
                <label className="block text-gray-400 text-[10px] mb-1">Hard Failure Rate (VISION_FAILURE_RATE %)</label>
                <input type="number" min="0" max="100" value={draftFailureRate} onChange={e => setDraftFailureRate(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 font-mono text-white text-xs" />
              </div>
              <div>
                <label className="block text-gray-400 text-[10px] mb-1">Processing Delay (VISION_DELAY_MS)</label>
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
                {lastResult.ocrText && <span className="ml-2 text-gray-300 truncate max-w-[150px] inline-block align-bottom">OCR: {lastResult.ocrText}</span>}
                {lastResult.confidence !== null && <span className="ml-2 text-gray-400">{(lastResult.confidence * 100).toFixed(1)}%</span>}
              </div>
            )}

            <div className="flex gap-2">
              <input
                value={jobId}
                onChange={e => setJobId(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-white"
                placeholder="Job ID"
              />
              <button
                onClick={handleVerify}
                disabled={verifying}
                className="bg-blue-700 hover:bg-blue-600 text-white rounded px-3 py-1 text-xs disabled:opacity-50 font-semibold"
              >
                {verifying ? 'Verifying…' : 'Verify'}
              </button>
            </div>
          </>
        )}
      </div>

      {!showConfig && results.length > 0 && (
        <div className="space-y-1 max-h-24 overflow-auto pt-2 border-t border-gray-800 mt-2">
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
