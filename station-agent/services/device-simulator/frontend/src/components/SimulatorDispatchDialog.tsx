import { useState, useEffect } from 'react'

export type DispatchTarget = 'simulation' | 'production-printer'
export type VisionScenario = 'success' | 'fail_qr_mismatch' | 'fail_unreadable' | 'fail_missing'

export interface DispatchConfig {
  target: DispatchTarget
  pcs: number
  scenario: VisionScenario
  station: string
  team: string
  notes: string
}

interface Props {
  open: boolean
  jobLabel: string        // "Print Job" | "Mark Job" | "Print + Mark"
  jobOp: string           // "PRINT_ONLY" | "MARK_ONLY" | "PRINT_AND_MARK"
  hasPcs: boolean
  hasScenario: boolean
  onClose: () => void
  onConfirm: (cfg: DispatchConfig) => void
}

const STORAGE_KEY = 'sim_dispatch_target'

const VISION_SCENARIOS: { value: VisionScenario; label: string; desc: string }[] = [
  { value: 'success',          label: '✅ Verification PASS',        desc: 'Camera inspects label successfully. High confidence.' },
  { value: 'fail_qr_mismatch', label: '⚠️ Fail — QR Code mismatch',  desc: 'QR code on label does not match product database.' },
  { value: 'fail_unreadable',  label: '🔴 Fail — Unreadable marking', desc: 'Low contrast or blurry marking, camera cannot decode.' },
  { value: 'fail_missing',     label: '🔴 Fail — Missing marking',    desc: 'Etching template completely missing from packaging.' },
]

export default function SimulatorDispatchDialog({ open, jobLabel, jobOp, hasPcs, hasScenario, onClose, onConfirm }: Props) {
  const [target, setTarget] = useState<DispatchTarget>(() => {
    try { return (localStorage.getItem(STORAGE_KEY) as DispatchTarget) || 'simulation' } catch { return 'simulation' }
  })
  const [pcs, setPcs]         = useState(10)
  const [scenario, setScenario] = useState<VisionScenario>('success')
  const [station, setStation]   = useState('Printer-01')
  const [team, setTeam]         = useState('Team A')
  const [notes, setNotes]       = useState('')
  const [step, setStep]         = useState<'target' | 'details'>('target')

  useEffect(() => { if (open) setStep('target') }, [open])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, target) } catch { /* ignore */ }
  }, [target])

  if (!open) return null

  const estimatedTimeMin = hasPcs ? Math.max(1, Math.ceil(pcs * 1.2 / 60)) : 1

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl" style={{ animation: 'fadeIn 0.15s ease' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-sm font-bold text-white">🚀 Dispatch Job</h2>
            <p className="text-[10px] text-gray-400 mt-0.5 font-mono">
              {jobLabel} · <span className="text-purple-400">{jobOp}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none transition-colors">✕</button>
        </div>

        {/* Step pills */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-gray-800/50 text-[10px] font-semibold">
          <span className={`px-2.5 py-0.5 rounded-full ${step === 'target' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400'}`}>
            1 · Execution Target
          </span>
          <span className="text-gray-700">→</span>
          <span className={`px-2.5 py-0.5 rounded-full ${step === 'details' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400'}`}>
            2 · Dispatch Details
          </span>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* ── STEP 1: TARGET SELECTION ── */}
          {step === 'target' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-400">Select where the generated print jobs will be sent:</p>

              {(['simulation', 'production-printer'] as DispatchTarget[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTarget(t)}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                    target === t
                      ? t === 'simulation' ? 'border-indigo-500 bg-indigo-950/30' : 'border-amber-500 bg-amber-950/20'
                      : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 mt-0.5 flex items-center justify-center shrink-0 ${
                      target === t
                        ? t === 'simulation' ? 'border-indigo-400' : 'border-amber-400'
                        : 'border-gray-600'
                    }`}>
                      {target === t && (
                        <div className={`w-2 h-2 rounded-full ${t === 'simulation' ? 'bg-indigo-400' : 'bg-amber-400'}`} />
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">
                        {t === 'simulation' ? '🖥️ Simulation Environment' : '🖨️ Production Printer'}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1 leading-relaxed">
                        {t === 'simulation'
                          ? 'Send jobs to Device Simulator (Virtual Printer / Mock Laser). Used for testing. No physical labels are printed.'
                          : 'Send jobs to the physical Zebra printer via CUPS / IPP. The Print Adapter routes the job to the real device.'}
                      </div>
                      <div className="mt-2 flex gap-2 flex-wrap">
                        {t === 'simulation' ? (
                          <>
                            <span className="text-[9px] bg-indigo-950/60 text-indigo-300 border border-indigo-900 px-1.5 py-0.5 rounded font-mono">TCP :9100</span>
                            <span className="text-[9px] bg-gray-900 text-gray-400 border border-gray-800 px-1.5 py-0.5 rounded font-mono">Always Available</span>
                          </>
                        ) : (
                          <>
                            <span className="text-[9px] bg-amber-950/60 text-amber-300 border border-amber-900 px-1.5 py-0.5 rounded font-mono">CUPS / IPP</span>
                            <span className="text-[9px] bg-amber-950/60 text-amber-300 border border-amber-900 px-1.5 py-0.5 rounded font-mono">Port 631</span>
                            <span className="text-[9px] bg-gray-900 text-gray-400 border border-gray-800 px-1.5 py-0.5 rounded font-mono">Zebra GK420t</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}

              <div className="flex justify-end pt-1">
                <button onClick={() => setStep('details')}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-lg text-xs font-bold transition-colors">
                  Continue →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: DISPATCH DETAILS ── */}
          {step === 'details' && (
            <div className="space-y-4">
              {/* Target badge */}
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
                target === 'simulation'
                  ? 'bg-indigo-950/30 border-indigo-800 text-indigo-300'
                  : 'bg-amber-950/30 border-amber-800 text-amber-300'
              }`}>
                <span>{target === 'simulation' ? '🖥️' : '🖨️'}</span>
                <span className="font-semibold">
                  {target === 'simulation' ? 'Simulation Environment' : 'Production Printer (CUPS)'}
                </span>
                <button onClick={() => setStep('target')}
                  className="ml-auto text-[10px] underline opacity-60 hover:opacity-100 text-gray-300">
                  Change
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                {/* PCS */}
                {hasPcs && (
                  <div className="col-span-2">
                    <label className="block text-gray-400 mb-1 font-semibold">Production Quantity (PCS)</label>
                    <input
                      type="number" min={1} max={1000} value={pcs}
                      onChange={e => setPcs(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono focus:border-indigo-500 focus:outline-none"
                    />
                    <div className="text-[10px] text-gray-500 mt-1">
                      1.2s delay between items · Estimated: ~{estimatedTimeMin} min
                    </div>
                  </div>
                )}

                {/* Vision scenario */}
                {hasScenario && (
                  <div className="col-span-2">
                    <label className="block text-gray-400 mb-1.5 font-semibold">Vision Verification Scenario</label>
                    <div className="space-y-1.5">
                      {VISION_SCENARIOS.map(s => (
                        <button key={s.value} onClick={() => setScenario(s.value)}
                          className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                            scenario === s.value
                              ? 'border-indigo-500/60 bg-indigo-950/20'
                              : 'border-gray-800 bg-gray-800/40 hover:border-gray-600'
                          }`}>
                          <div className="text-[11px] font-semibold text-gray-200">{s.label}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">{s.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Station */}
                <div>
                  <label className="block text-gray-400 mb-1 font-semibold">Target Station</label>
                  <input value={station} onChange={e => setStation(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono focus:border-indigo-500 focus:outline-none" />
                </div>

                {/* Team */}
                <div>
                  <label className="block text-gray-400 mb-1 font-semibold">Execution Team</label>
                  <input value={team} onChange={e => setTeam(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono focus:border-indigo-500 focus:outline-none" />
                </div>

                {/* Notes */}
                <div className="col-span-2">
                  <label className="block text-gray-400 mb-1 font-semibold">Dispatch Notes</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                    placeholder="Optional notes for this dispatch..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-xs focus:border-indigo-500 focus:outline-none resize-none" />
                </div>
              </div>

              {/* Dispatch Summary */}
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-3 space-y-2">
                <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Dispatch Summary</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px]">
                  <div className="text-gray-500">Job Type</div>
                  <div className="text-gray-200 font-mono">{jobLabel}</div>
                  <div className="text-gray-500">Operation</div>
                  <div className="text-purple-300 font-mono">{jobOp}</div>
                  <div className="text-gray-500">Execution Target</div>
                  <div className={`font-semibold ${target === 'simulation' ? 'text-indigo-300' : 'text-amber-300'}`}>
                    {target === 'simulation' ? 'Simulation Environment' : 'Production Printer'}
                  </div>
                  {hasPcs && <><div className="text-gray-500">Quantity</div><div className="text-gray-200 font-mono">{pcs} PCS</div></>}
                  {hasScenario && <><div className="text-gray-500">Vision Scenario</div><div className="text-gray-200 font-mono">{scenario}</div></>}
                  <div className="text-gray-500">Station</div><div className="text-gray-200 font-mono">{station}</div>
                  <div className="text-gray-500">Team</div><div className="text-gray-200 font-mono">{team}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button onClick={() => setStep('target')}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 transition-colors">
                  ← Back
                </button>
                <button
                  onClick={() => onConfirm({ target, pcs, scenario, station, team, notes })}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold text-white transition-colors ${
                    target === 'simulation' ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-amber-600 hover:bg-amber-500'
                  }`}
                >
                  🚀 Dispatch {hasPcs ? `${pcs} PCS` : ''} → {target === 'simulation' ? 'Simulation' : 'Production Printer'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
