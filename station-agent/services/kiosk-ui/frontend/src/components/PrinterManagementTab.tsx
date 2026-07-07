import { useEffect, useState, useCallback } from 'react'
import { templateApi } from '@/api/client'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Printer, PlusCircle, XCircle, RefreshCw, CheckCircle2, WifiOff,
  Layers, Tag, Zap
} from 'lucide-react'

interface ReadyPrinter {
  id: string
  printerCode: string
  displayName: string
  ipAddress: string
  port: number
  protocol: string
  vendor: string
  status: string
  driverType: string
  lastHeartbeatAt?: string
  isActiveForWork: boolean
  activeTemplateId?: string
  activeTemplateName?: string
}

interface LabelTemplate {
  id: string
  name: string
  description?: string
  status: string
  dpi: number
  labelWidth: number
  labelHeight: number
  version: number
}

function StatusDot({ status }: { status: string }) {
  const s = (status || '').toUpperCase()
  const color = s === 'ONLINE' || s === 'IDLE' ? '#22c55e'
    : s === 'PRINTING' ? '#3b82f6' : '#ef4444'
  return (
    <span style={{
      display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
      background: color, boxShadow: `0 0 6px ${color}88`, marginRight: 6, flexShrink: 0
    }} />
  )
}

function PrinterCard({
  printer, onActivate, onDeactivate,
}: {
  printer: ReadyPrinter
  onActivate: (p: ReadyPrinter) => void
  onDeactivate: (code: string) => void
}) {
  const active = printer.isActiveForWork
  return (
    <div style={{
      background: active
        ? 'linear-gradient(135deg,rgba(34,197,94,.08) 0%,rgba(16,185,129,.05) 100%)'
        : 'rgba(255,255,255,.04)',
      border: `1px solid ${active ? 'rgba(34,197,94,.35)' : 'rgba(255,255,255,.08)'}`,
      borderRadius: 14, padding: '18px 20px', display: 'flex',
      flexDirection: 'column', gap: 10,
      transition: 'all .2s ease', position: 'relative', overflow: 'hidden',
    }}>
      {active && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: 'linear-gradient(90deg,#22c55e,#10b981)', borderRadius: '14px 14px 0 0',
        }} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: active ? 'rgba(34,197,94,.15)' : 'rgba(99,102,241,.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Printer size={18} color={active ? '#22c55e' : '#818cf8'} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#f1f5f9' }}>{printer.displayName}</div>
            <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{printer.printerCode}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={printer.status} />
          <span style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            {printer.status}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'rgba(99,102,241,.12)', color: '#a5b4fc', fontFamily: 'monospace' }}>
          {printer.ipAddress}:{printer.port}
        </span>
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,.05)', color: '#64748b' }}>
          {printer.protocol} · {printer.driverType}
        </span>
      </div>

      {active && printer.activeTemplateName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 9, background: 'rgba(34,197,94,.09)', border: '1px solid rgba(34,197,94,.2)' }}>
          <Tag size={12} color="#4ade80" />
          <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 500 }}>{printer.activeTemplateName}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        {active ? (
          <button
            onClick={() => onDeactivate(printer.printerCode)}
            style={{ flex: 1, padding: '8px 14px', borderRadius: 9, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)', color: '#f87171', fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,.16)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,.08)' }}
          >
            <XCircle size={13} /> Go khoi danh sach
          </button>
        ) : (
          <button
            onClick={() => onActivate(printer)}
            style={{ flex: 1, padding: '8px 14px', borderRadius: 9, border: '1px solid rgba(99,102,241,.35)', background: 'rgba(99,102,241,.12)', color: '#a5b4fc', fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,.22)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,.12)' }}
          >
            <PlusCircle size={13} /> Them vao san xuat
          </button>
        )}
      </div>
    </div>
  )
}

export function PrinterManagementTab() {
  const [printers, setPrinters] = useState<ReadyPrinter[]>([])
  const [templates, setTemplates] = useState<LabelTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activating, setActivating] = useState<ReadyPrinter | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [activateLoading, setActivateLoading] = useState(false)
  const [activateError, setActivateError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [readyRes, activeRes] = await Promise.all([
        templateApi.getPrintersReady(),
        templateApi.getPrintersActive(),
      ])
      const activeMap = new Map<string, ReadyPrinter>()
      for (const p of (activeRes.data ?? [])) activeMap.set(p.printerCode, p)
      const merged: ReadyPrinter[] = (readyRes.data ?? []).map((p: ReadyPrinter) =>
        activeMap.has(p.printerCode) ? activeMap.get(p.printerCode)! : p,
      )
      for (const [code, p] of activeMap.entries()) {
        if (!merged.find(r => r.printerCode === code)) merged.push(p)
      }
      setPrinters(merged)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string }
      setError(err?.response?.data?.error ?? err?.message ?? 'Cannot load printer list')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await templateApi.list({ status: 'published' })
      setTemplates(res.data ?? [])
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    fetchData()
    fetchTemplates()
    const id = setInterval(fetchData, 15_000)
    return () => clearInterval(id)
  }, [fetchData, fetchTemplates])

  const openActivate = (printer: ReadyPrinter) => {
    setActivating(printer)
    setSelectedTemplateId('')
    setActivateError(null)
  }

  const confirmActivate = async () => {
    if (!activating || !selectedTemplateId) {
      setActivateError('Please select a template first')
      return
    }
    setActivateLoading(true)
    setActivateError(null)
    try {
      await templateApi.activatePrinter(activating.printerCode, selectedTemplateId)
      setActivating(null)
      await fetchData()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string }
      setActivateError(err?.response?.data?.error ?? err?.message ?? 'Activation failed')
    } finally {
      setActivateLoading(false)
    }
  }

  const deactivate = async (code: string) => {
    try {
      await templateApi.deactivatePrinter(code)
      await fetchData()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string }
      setError(err?.response?.data?.error ?? err?.message ?? 'Deactivation failed')
    }
  }

  const activePrinters  = printers.filter(p => p.isActiveForWork)
  const readyPrinters   = printers.filter(p => !p.isActiveForWork)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      <style>{"@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}"}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Printer size={18} color="#fff" />
            </div>
            Quan ly thiet bi in
          </h2>
          <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 0 46px' }}>
            Thiet bi san sang tu printer-adapter — chon template de dua vao san xuat
          </p>
        </div>
        <button
          onClick={fetchData} disabled={loading}
          style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.04)', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500 }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.08)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.04)' }}
        >
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Lam moi
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#f87171', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* ── Active printers ── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#22c55e,#16a34a)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Zap size={14} color="#fff" />
          </div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', margin: 0 }}>May in dang san xuat</h3>
          <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: activePrinters.length > 0 ? 'rgba(34,197,94,.15)' : 'rgba(255,255,255,.06)', color: activePrinters.length > 0 ? '#4ade80' : '#475569' }}>
            {activePrinters.length}
          </span>
        </div>
        {activePrinters.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', borderRadius: 14, border: '1px dashed rgba(255,255,255,.07)', color: '#475569', fontSize: 13 }}>
            <Printer size={28} style={{ margin: '0 auto 10px', display: 'block', opacity: .25 }} />
            Chua co may in nao duoc kich hoat.<br />Them tu danh sach thiet bi ben duoi.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
            {activePrinters.map(p => (
              <PrinterCard key={p.printerCode} printer={p} onActivate={openActivate} onDeactivate={deactivate} />
            ))}
          </div>
        )}
      </section>

      <div style={{ height: 1, background: 'rgba(255,255,255,.06)' }} />

      {/* ── Ready printers ── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#6366f1,#818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Layers size={14} color="#fff" />
          </div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', margin: 0 }}>Thiet bi san sang (online)</h3>
          <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'rgba(99,102,241,.15)', color: '#a5b4fc' }}>
            {readyPrinters.length}
          </span>
        </div>
        {loading && printers.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#475569', fontSize: 13 }}>
            <RefreshCw size={22} style={{ margin: '0 auto 10px', display: 'block', opacity: .3, animation: 'spin 1s linear infinite' }} />
            Dang tai danh sach thiet bi...
          </div>
        ) : readyPrinters.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', borderRadius: 14, border: '1px dashed rgba(255,255,255,.07)', color: '#475569', fontSize: 13 }}>
            <WifiOff size={28} style={{ margin: '0 auto 10px', display: 'block', opacity: .25 }} />
            Khong co thiet bi nao dang online.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
            {readyPrinters.map(p => (
              <PrinterCard key={p.printerCode} printer={p} onActivate={openActivate} onDeactivate={deactivate} />
            ))}
          </div>
        )}
      </section>

      {/* ── Activate modal ── */}
      <Dialog open={activating !== null} onOpenChange={open => { if (!open) setActivating(null) }}>
        <DialogContent style={{ background: 'linear-gradient(135deg,#0f172a 0%,#1e293b 100%)', border: '1px solid rgba(99,102,241,.2)', borderRadius: 18, maxWidth: 540 }}>
          <DialogHeader>
            <DialogTitle style={{ color: '#f1f5f9', fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Printer size={18} color="#818cf8" />
              Chon template cho {activating?.displayName}
            </DialogTitle>
            <DialogDescription style={{ color: '#64748b', fontSize: 13 }}>
              Bat buoc chon label template truoc khi them may in vao san xuat.
            </DialogDescription>
          </DialogHeader>

          {activateError && (
            <div style={{ padding: '10px 14px', borderRadius: 9, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', color: '#f87171', fontSize: 13 }}>
              {activateError}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', padding: '4px 0' }}>
            {templates.length === 0 ? (
              <div style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                Khong co template nao duoc publish.
              </div>
            ) : templates.map(t => {
              const sel = t.id === selectedTemplateId
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedTemplateId(t.id)}
                  style={{ padding: '12px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', border: `1px solid ${sel ? 'rgba(99,102,241,.5)' : 'rgba(255,255,255,.07)'}`, background: sel ? 'rgba(99,102,241,.12)' : 'rgba(255,255,255,.03)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: sel ? '#a5b4fc' : '#e2e8f0' }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{t.labelWidth} x {t.labelHeight} mm · {t.dpi} DPI · v{t.version}</div>
                  </div>
                  {sel && <CheckCircle2 size={16} color="#818cf8" />}
                </button>
              )
            })}
          </div>

          <DialogFooter style={{ gap: 8 }}>
            <Button variant="outline" onClick={() => setActivating(null)} style={{ borderColor: 'rgba(255,255,255,.1)', color: '#94a3b8', background: 'transparent' }}>
              Huy
            </Button>
            <Button
              onClick={confirmActivate}
              disabled={!selectedTemplateId || activateLoading}
              style={{ background: selectedTemplateId ? 'linear-gradient(135deg,#6366f1,#818cf8)' : 'rgba(99,102,241,.2)', color: selectedTemplateId ? '#fff' : '#4b5563', border: 'none' }}
            >
              {activateLoading ? 'Dang xu ly...' : 'Xac nhan & Them vao san xuat'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
