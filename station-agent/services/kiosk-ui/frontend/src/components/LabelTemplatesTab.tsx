import { useEffect, useState, useCallback, useRef } from 'react'
import { templateApi, printerApi } from '@/api/client'
import { LabelPreview } from '@/components/LabelPreview'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table as TableEl, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  FileText, Plus, Search, RefreshCw, Star, Archive, CheckCircle2,
  Download, Upload, Copy, Trash2, Edit2, Eye, Printer as PrinterIcon,
  History, AlertTriangle, Check, Settings2,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LabelTemplate {
  id: string
  name: string
  description?: string
  note?: string
  templateCode?: string
  category?: string
  orientation?: string
  revision?: string
  supportedBarcodeTypes?: string
  supportedPrinterModels?: string
  compatibleStationTypes?: string
  dpi: number
  labelWidth: number
  labelHeight: number
  templateJson: object
  version: number
  status: 'draft' | 'published' | 'archived'
  isDefault: boolean
  isActive: boolean
  createdBy?: string
  updatedBy?: string
  createdAt: string
  updatedAt: string
}

interface PrinterAssignment {
  id: string
  printerCode: string
  templateId: string
  templateName?: string
  assignedAt: string
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function TemplateBadge({ status, isDefault }: { status: string; isDefault: boolean }) {
  const color = status === 'published' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : status === 'draft' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    : 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'
  const label = status === 'published' ? 'Published' : status === 'draft' ? 'Draft' : 'Archived'
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${color}`}>
        {label}
      </span>
      {isDefault && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-blue-500/15 text-blue-400 border-blue-500/30">
          <Star size={9} /> Default
        </span>
      )}
    </div>
  )
}

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  PRODUCT:    { label: 'Product',    color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' },
  WIP:        { label: 'WIP',        color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' },
  PALLET:     { label: 'Pallet',     color: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
  SHELF:      { label: 'Shelf',      color: 'bg-teal-500/15 text-teal-400 border-teal-500/30' },
  INSPECTION: { label: 'Inspection', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  MATERIAL:   { label: 'Material',   color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  SHEET:      { label: 'Sheet',      color: 'bg-lime-500/15 text-lime-400 border-lime-500/30' },
  ISSUE:      { label: 'Issue',      color: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
}

function CategoryBadge({ category }: { category?: string }) {
  if (!category) return null
  const meta = CATEGORY_META[category.toUpperCase()] ?? { label: category, color: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${meta.color}`}>
      {meta.label}
    </span>
  )
}

// ── Template Editor Dialog ────────────────────────────────────────────────────

const BLANK_TEMPLATE_JSON = JSON.stringify({
  width: 50, height: 30, dpi: 203,
  elements: [
    { type: 'text', x: 10, y: 20, fontSize: 14, text: 'Company Name' },
    { type: 'text', x: 10, y: 55, fontSize: 10, binding: 'product_name', defaultValue: 'Product' },
    { type: 'qr', x: 260, y: 60, magnification: 4, payloadTemplate: '{serial_number}' },
  ]
}, null, 2)

function TemplateEditorDialog({
  open,
  template,
  printers,
  onClose,
  onSaved,
}: {
  open: boolean
  template: LabelTemplate | null
  printers: any[]
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!template
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [note, setNote] = useState('')
  const [dpi, setDpi] = useState('203')
  const [width, setWidth] = useState('50')
  const [height, setHeight] = useState('30')
  const [jsonText, setJsonText] = useState(BLANK_TEMPLATE_JSON)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [parsedJson, setParsedJson] = useState<object | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testPrinter, setTestPrinter] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; msg: string } | null>(null)

  useEffect(() => {
    if (open) {
      if (template) {
        setName(template.name)
        setDescription(template.description ?? '')
        setNote(template.note ?? '')
        setDpi(String(template.dpi))
        setWidth(String(template.labelWidth))
        setHeight(String(template.labelHeight))
        const raw = JSON.stringify(template.templateJson, null, 2)
        setJsonText(raw)
        tryParseJson(raw)
      } else {
        setName(''); setDescription(''); setNote(''); setDpi('203'); setWidth('50'); setHeight('30')
        setJsonText(BLANK_TEMPLATE_JSON)
        tryParseJson(BLANK_TEMPLATE_JSON)
      }
      setError(null); setTestResult(null); setTesting(false)
    }
  }, [open, template])

  const tryParseJson = (text: string) => {
    try {
      const p = JSON.parse(text)
      setParsedJson(p); setJsonError(null)
    } catch (e: any) {
      setParsedJson(null); setJsonError(e.message)
    }
  }

  const handleJsonChange = (v: string) => { setJsonText(v); tryParseJson(v) }

  const handleSave = async () => {
    if (jsonError) { setError('Fix JSON errors before saving.'); return }
    setSaving(true); setError(null)
    try {
      const payload = {
        name, description: description || undefined,
        note: note || undefined,
        dpi: parseInt(dpi), labelWidth: parseFloat(width), labelHeight: parseFloat(height),
        templateJson: jsonText,
      }
      if (isEdit) await templateApi.update(template!.id, payload)
      else await templateApi.create(payload)
      onSaved()
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message)
    } finally { setSaving(false) }
  }

  const handleTestPrint = async () => {
    if (!testPrinter) { setTestResult({ success: false, msg: 'Select a printer first.' }); return }
    setTesting(true); setTestResult(null)
    try {
      const res = await templateApi.printTest(template!.id, {
        printerCode: testPrinter,
        data: { serial_number: 'TEST-001', product_code: 'TEST-P01', product_name: 'Test Product', batch_number: 'BATCH-TEST', revision: 'A', production_date: new Date().toISOString().split('T')[0] }
      })
      setTestResult({ success: res.data.success, msg: res.data.success ? `Printed! Duration: ${res.data.durationMs}ms` : 'Print failed — check printer.' })
    } catch (e: any) {
      setTestResult({ success: false, msg: e.response?.data?.error ?? e.message })
    } finally { setTesting(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col bg-zinc-900 border-zinc-700 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {isEdit ? `Edit Template — ${template?.name}` : 'New Label Template'}
          </DialogTitle>
          <DialogDescription className="text-zinc-400 text-xs">
            {isEdit ? `Version ${template?.version} · ${template?.status}` : 'Configure label layout and elements'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden grid grid-cols-2 gap-4 min-h-0">
          {/* Left — Form */}
          <div className="overflow-y-auto pr-1 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="text-xs text-zinc-400 mb-1 block">Template Name *</label>
                <Input id="tpl-name" value={name} onChange={e => setName(e.target.value)}
                  placeholder="50x30 QR Label" className="bg-zinc-800 border-zinc-700 text-zinc-100 h-8 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-zinc-400 mb-1 block">Mô tả (Description)</label>
                <Input id="tpl-desc" value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Mô tả ngắn về mẫu tem..." className="bg-zinc-800 border-zinc-700 text-zinc-100 h-8 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-zinc-400 mb-1 block">Ghi chú sản xuất (Note)</label>
                <textarea
                  id="tpl-note"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={3}
                  placeholder="Ghi chú cho kỹ sư sản xuất: mục đích sử dụng, công đoạn áp dụng, yêu cầu máy in..."
                  className="w-full rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 resize-y focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">DPI</label>
                <Select value={dpi} onValueChange={setDpi}>
                  <SelectTrigger id="tpl-dpi" className="bg-zinc-800 border-zinc-700 text-zinc-100 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700 text-zinc-100">
                    <SelectItem value="203">203 DPI</SelectItem>
                    <SelectItem value="300">300 DPI</SelectItem>
                    <SelectItem value="600">600 DPI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">W (mm)</label>
                  <Input id="tpl-width" value={width} onChange={e => setWidth(e.target.value)} type="number"
                    className="bg-zinc-800 border-zinc-700 text-zinc-100 h-8 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">H (mm)</label>
                  <Input id="tpl-height" value={height} onChange={e => setHeight(e.target.value)} type="number"
                    className="bg-zinc-800 border-zinc-700 text-zinc-100 h-8 text-sm" />
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-zinc-400">Template JSON (Elements)</label>
                {jsonError && <span className="text-red-400 text-[10px] flex items-center gap-1"><AlertTriangle size={10} />{jsonError.slice(0, 60)}</span>}
              </div>
              <textarea
                id="tpl-json"
                value={jsonText}
                onChange={e => handleJsonChange(e.target.value)}
                className={`w-full h-64 bg-zinc-950 border rounded-md text-xs font-mono p-2 text-zinc-200 resize-none outline-none focus:ring-1 ${jsonError ? 'border-red-500/60 focus:ring-red-500/40' : 'border-zinc-700 focus:ring-blue-500/40'}`}
                spellCheck={false}
              />
            </div>

            {/* Test print (edit mode only) */}
            {isEdit && (
              <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3 space-y-2">
                <div className="text-xs text-zinc-400 font-medium">Test Print</div>
                <div className="flex gap-2">
                  <Select value={testPrinter} onValueChange={setTestPrinter}>
                    <SelectTrigger id="tpl-test-printer" className="bg-zinc-800 border-zinc-700 text-zinc-100 h-8 text-sm flex-1">
                      <SelectValue placeholder="Select printer…" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700 text-zinc-100">
                      {printers.map(p => (
                        <SelectItem key={p.printerCode ?? p.PrinterCode} value={p.printerCode ?? p.PrinterCode}>
                          {p.displayName ?? p.DisplayName} ({p.printerCode ?? p.PrinterCode})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button id="tpl-test-print-btn" size="sm" onClick={handleTestPrint} disabled={testing}
                    className="bg-blue-600 hover:bg-blue-500 h-8 text-xs">
                    {testing ? <RefreshCw size={12} className="animate-spin mr-1" /> : <PrinterIcon size={12} className="mr-1" />}
                    Test Print
                  </Button>
                </div>
                {testResult && (
                  <div className={`text-xs flex items-center gap-1.5 ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                    {testResult.success ? <Check size={12} /> : <AlertTriangle size={12} />}
                    {testResult.msg}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right — Live Preview */}
          <div className="overflow-y-auto space-y-2">
            <div className="text-xs text-zinc-400 font-medium mb-1">Live Preview</div>
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 flex items-center justify-center min-h-40">
              {parsedJson ? (
                <LabelPreview
                  template={parsedJson as any}
                  data={{ serial_number: 'SN-TEST-001', product_code: 'P-TEST-01', product_name: 'Test Product', batch_number: 'BATCH-01', revision: 'A', production_date: new Date().toISOString().split('T')[0] }}
                  width={360}
                />
              ) : (
                <div className="text-zinc-500 text-xs italic">Fix JSON to see preview</div>
              )}
            </div>
            <div className="text-[10px] text-zinc-600 text-center">
              Preview uses sample data. Actual print may differ based on runtime values.
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-2 text-red-400 text-xs flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
            <AlertTriangle size={12} /> {error}
          </div>
        )}

        <DialogFooter className="mt-3 gap-2">
          <Button variant="ghost" onClick={onClose} className="text-zinc-400 hover:text-zinc-100 h-8 text-sm">Cancel</Button>
          <Button id="tpl-save-btn" onClick={handleSave} disabled={saving || !!jsonError}
            className="bg-indigo-600 hover:bg-indigo-500 h-8 text-sm">
            {saving ? <RefreshCw size={12} className="animate-spin mr-1" /> : null}
            {isEdit ? 'Save Changes' : 'Create Template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Preview Dialog ────────────────────────────────────────────────────────────

function TemplatePreviewDialog({ open, template, onClose }: { open: boolean; template: LabelTemplate | null; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl bg-zinc-900 border-zinc-700 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{template?.name}</DialogTitle>
          <DialogDescription className="text-zinc-400 text-xs">
            v{template?.version} · {template?.labelWidth}×{template?.labelHeight}mm · {template?.dpi} DPI
            {template?.orientation && ` · ${template.orientation}`}
            {template?.revision && ` · Rev ${template.revision}`}
          </DialogDescription>
        </DialogHeader>
        {/* Metadata row */}
        {(template?.category || template?.templateCode) && (
          <div className="flex items-center gap-2 flex-wrap">
            {template?.category && <CategoryBadge category={template.category} />}
            {template?.templateCode && (
              <span className="font-mono text-[11px] text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700">
                {template.templateCode}
              </span>
            )}
            {template?.supportedBarcodeTypes && (
              <span className="text-[11px] text-zinc-500">
                {(() => { try { return (JSON.parse(template.supportedBarcodeTypes) as string[]).join(' · ') } catch { return template.supportedBarcodeTypes } })()}
              </span>
            )}
          </div>
        )}
        {/* Note — Ghi chú sản xuất */}
        {template?.note && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
              <span>📋</span> Ghi chú sản xuất
            </div>
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed font-sans">
              {template.note}
            </pre>
          </div>
        )}
        <div className="flex items-center justify-center py-4 bg-zinc-950 border border-zinc-800 rounded-lg">
          {template && (
            <LabelPreview
              template={template.templateJson as any}
              data={{ serial_number: 'SN-PREVIEW-001', product_code: 'P-PREVIEW-01', product_name: 'Preview Product', batch_number: 'BATCH-PREVIEW', revision: 'B', production_date: new Date().toISOString().split('T')[0] }}
              width={460}
            />
          )}
        </div>
        {template?.description && (
          <p className="text-xs text-zinc-500 italic px-1">{template.description}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-zinc-400 h-8 text-sm">Đóng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Print History Dialog ──────────────────────────────────────────────────────

function PrintHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [records, setRecords] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<any | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await templateApi.getPrintHistory(1, 50)
      setRecords(res.data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { if (open) { load(); setSelected(null) } }, [open, load])

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col bg-zinc-900 border-zinc-700 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <History size={16} className="text-blue-400" /> Print History
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-zinc-500 text-sm">
              <RefreshCw size={16} className="animate-spin mr-2" /> Loading…
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-sm">No print history yet.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                {records.map(r => (
                  <div key={r.id}
                    onClick={() => setSelected(r)}
                    className={`p-2.5 rounded-lg border cursor-pointer transition-colors text-xs ${selected?.id === r.id ? 'border-blue-500/50 bg-blue-500/10' : 'border-zinc-700/60 bg-zinc-800/40 hover:border-zinc-600'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-zinc-200 truncate max-w-[60%]">{r.templateName}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${r.status === 'SUCCESS' ? 'bg-emerald-500/20 text-emerald-400' : r.status === 'FAILED' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
                        {r.status}
                      </span>
                    </div>
                    <div className="text-zinc-500 flex gap-3">
                      <span>v{r.templateVersion}</span>
                      <span>{r.printerCode}</span>
                      <span>{r.durationMs}ms</span>
                    </div>
                    <div className="text-zinc-600 mt-0.5">{new Date(r.createdAt).toLocaleString()}</div>
                  </div>
                ))}
              </div>
              <div className="sticky top-0">
                {selected ? (
                  <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3 space-y-2">
                    <div className="text-xs font-semibold text-zinc-200 mb-2">Details — {selected.templateName}</div>
                    <div className="grid grid-cols-2 gap-1 text-xs text-zinc-400">
                      <span>Status:</span><span className="text-zinc-200">{selected.status}</span>
                      <span>Version:</span><span className="text-zinc-200">v{selected.templateVersion}</span>
                      <span>Printer:</span><span className="text-zinc-200">{selected.printerCode}</span>
                      <span>Duration:</span><span className="text-zinc-200">{selected.durationMs}ms</span>
                      <span>Trace ID:</span><span className="text-zinc-300 font-mono text-[10px] truncate">{selected.traceId?.slice(0, 16)}…</span>
                    </div>
                    {selected.renderedZpl && (
                      <div>
                        <div className="text-xs text-zinc-500 mb-1">Rendered ZPL</div>
                        <pre className="text-[10px] font-mono bg-zinc-950 text-zinc-300 p-2 rounded max-h-40 overflow-y-auto border border-zinc-700">
                          {selected.renderedZpl?.slice(0, 800)}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-zinc-600 text-xs text-center py-8">Select a record to see details</div>
                )}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-zinc-400 h-8 text-sm">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Label Templates Tab ──────────────────────────────────────────────────

export function LabelTemplatesTab() {
  const [templates, setTemplates] = useState<LabelTemplate[]>([])
  const [printers, setPrinters] = useState<any[]>([])
  const [assignments, setAssignments] = useState<PrinterAssignment[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')

  // Dialogs
  const [editorOpen, setEditorOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<LabelTemplate | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewTarget, setPreviewTarget] = useState<LabelTemplate | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)

  // Per-printer assignment selections
  const [assignSelections, setAssignSelections] = useState<Record<string, string>>({})
  const [assignSaving, setAssignSaving] = useState(false)

  const importRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: any = {}
      if (statusFilter !== 'all') params.status = statusFilter
      if (statusFilter === 'archived') params.includeArchived = true
      const [tRes, pRes, aRes] = await Promise.all([
        templateApi.list(params),
        printerApi.list(),
        templateApi.getAssignments(),
      ])
      setTemplates(tRes.data)
      setPrinters(pRes.data)
      setAssignments(aRes.data)
      // Pre-fill assignment selects
      const sel: Record<string, string> = {}
      aRes.data.forEach((a: any) => { sel[a.printerCode ?? a.PrinterCode] = a.templateId })
      setAssignSelections(sel)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  const filtered = templates.filter(t => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.description ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (t.templateCode ?? '').toLowerCase().includes(search.toLowerCase())
    const matchCategory = categoryFilter === 'all' || (t.category ?? '').toUpperCase() === categoryFilter
    return matchSearch && matchCategory
  })

  const handlePublish = async (id: string) => {
    try { await templateApi.publish(id); await load() } catch { /* ignore */ }
  }
  const handleArchive = async (id: string) => {
    try { await templateApi.archive(id); await load() } catch { /* ignore */ }
  }
  const handleSetDefault = async (id: string) => {
    try { await templateApi.setDefault(id); await load() } catch { /* ignore */ }
  }
  const handleDuplicate = async (id: string) => {
    try { await templateApi.duplicate(id); await load() } catch { /* ignore */ }
  }
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template? This action cannot be undone.')) return
    try { await templateApi.delete(id); await load() } catch { /* ignore */ }
  }
  const handleExport = async (t: LabelTemplate) => {
    const res = await templateApi.exportTemplate(t.id)
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a'); a.href = url
    a.download = `${t.name.replace(/\s+/g, '_')}_v${t.version}.json`
    a.click(); window.URL.revokeObjectURL(url)
  }
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const text = await file.text()
    try {
      const json = JSON.parse(text)
      await templateApi.importTemplate(json)
      await load()
    } catch (err: any) { alert(`Import failed: ${err.message}`) }
    finally { if (importRef.current) importRef.current.value = '' }
  }

  const handleSaveAssignments = async () => {
    setAssignSaving(true)
    try {
      for (const printer of printers) {
        const code = printer.printerCode ?? printer.PrinterCode
        const selectedId = assignSelections[code]
        const current = assignments.find(a => (a.printerCode ?? (a as any).PrinterCode) === code)
        if (selectedId && selectedId !== 'none') {
          if (!current || current.templateId !== selectedId) {
            await templateApi.assignTemplate(code, selectedId)
          }
        } else if (current) {
          await templateApi.removeAssignment(code)
        }
      }
      await load()
      setAssignOpen(false)
    } catch (e: any) { alert(`Save failed: ${e.message}`) }
    finally { setAssignSaving(false) }
  }

  return (
    <div className="space-y-4 p-1">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <FileText size={18} className="text-indigo-400" /> Label Templates
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">{templates.length} template{templates.length !== 1 ? 's' : ''} · manage layouts, assign to printers</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button id="tpl-history-btn" variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}
            className="text-zinc-400 hover:text-zinc-100 h-8 text-xs border border-zinc-700 hover:border-zinc-600 gap-1.5">
            <History size={13} /> Print History
          </Button>
          <Button id="tpl-assign-btn" variant="ghost" size="sm" onClick={() => setAssignOpen(true)}
            className="text-zinc-400 hover:text-zinc-100 h-8 text-xs border border-zinc-700 hover:border-zinc-600 gap-1.5">
            <Settings2 size={13} /> Printer Assignments
          </Button>
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <Button id="tpl-import-btn" variant="ghost" size="sm" onClick={() => importRef.current?.click()}
            className="text-zinc-400 hover:text-zinc-100 h-8 text-xs border border-zinc-700 hover:border-zinc-600 gap-1.5">
            <Upload size={13} /> Import
          </Button>
          <Button id="tpl-new-btn" size="sm" onClick={() => { setEditTarget(null); setEditorOpen(true) }}
            className="bg-indigo-600 hover:bg-indigo-500 h-8 text-xs gap-1.5">
            <Plus size={13} /> New Template
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <Input id="tpl-search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search templates…" className="pl-8 h-8 text-xs bg-zinc-800 border-zinc-700 text-zinc-100" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger id="tpl-category-filter" className="w-36 h-8 text-xs bg-zinc-800 border-zinc-700 text-zinc-100">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700 text-zinc-100">
            <SelectItem value="all">All categories</SelectItem>
            {Object.entries(CATEGORY_META).map(([key, meta]) => (
              <SelectItem key={key} value={key}>{meta.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger id="tpl-status-filter" className="w-36 h-8 text-xs bg-zinc-800 border-zinc-700 text-zinc-100">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700 text-zinc-100">
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Button id="tpl-refresh-btn" variant="ghost" size="sm" onClick={load} disabled={loading}
          className="text-zinc-400 hover:text-zinc-100 h-8 border border-zinc-700">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <TableEl>
          <TableHeader>
            <TableRow className="border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900/50">
              <TableHead className="text-zinc-400 text-xs font-medium h-9 pl-4">Name</TableHead>
              <TableHead className="text-zinc-400 text-xs font-medium h-9">Category</TableHead>
              <TableHead className="text-zinc-400 text-xs font-medium h-9">Size</TableHead>
              <TableHead className="text-zinc-400 text-xs font-medium h-9">DPI</TableHead>
              <TableHead className="text-zinc-400 text-xs font-medium h-9">Ver.</TableHead>
              <TableHead className="text-zinc-400 text-xs font-medium h-9">Status</TableHead>
              <TableHead className="text-zinc-400 text-xs font-medium h-9">Updated</TableHead>
              <TableHead className="text-zinc-400 text-xs font-medium h-9 pr-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={7} className="text-center py-12 text-zinc-500 text-sm">
                  <RefreshCw size={16} className="animate-spin inline mr-2" />Loading templates…
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={7} className="text-center py-12 text-zinc-600 text-sm">
                  No templates found.
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.map(t => (
              <TableRow key={t.id} className="border-zinc-800 hover:bg-zinc-800/30 transition-colors">
                <TableCell className="pl-4 py-2.5">
                  <div className="font-medium text-zinc-200 text-sm">{t.name}</div>
                  {t.templateCode && (
                    <div className="font-mono text-[10px] text-zinc-500 mt-0.5">{t.templateCode}</div>
                  )}
                  {t.description && <div className="text-zinc-500 text-[11px] truncate max-w-xs">{t.description}</div>}
                </TableCell>
                <TableCell className="py-2.5">
                  <CategoryBadge category={t.category} />
                </TableCell>
                <TableCell className="py-2.5 text-xs text-zinc-300 font-mono">{t.labelWidth}×{t.labelHeight}mm</TableCell>
                <TableCell className="py-2.5 text-xs text-zinc-400">{t.dpi}</TableCell>
                <TableCell className="py-2.5 text-xs text-zinc-400">v{t.version}</TableCell>
                <TableCell className="py-2.5"><TemplateBadge status={t.status} isDefault={t.isDefault} /></TableCell>
                <TableCell className="py-2.5 text-xs text-zinc-500">{new Date(t.updatedAt).toLocaleDateString()}</TableCell>
                <TableCell className="pr-4 py-2.5">
                  <div className="flex items-center gap-1 justify-end">
                    <button id={`tpl-preview-${t.id}`} onClick={() => { setPreviewTarget(t); setPreviewOpen(true) }}
                      title="Preview" className="p-1.5 rounded text-zinc-500 hover:text-blue-400 hover:bg-blue-400/10 transition-colors">
                      <Eye size={13} />
                    </button>
                    <button id={`tpl-edit-${t.id}`} onClick={() => { setEditTarget(t); setEditorOpen(true) }}
                      title="Edit" className="p-1.5 rounded text-zinc-500 hover:text-indigo-400 hover:bg-indigo-400/10 transition-colors">
                      <Edit2 size={13} />
                    </button>
                    <button id={`tpl-dup-${t.id}`} onClick={() => handleDuplicate(t.id)}
                      title="Duplicate" className="p-1.5 rounded text-zinc-500 hover:text-amber-400 hover:bg-amber-400/10 transition-colors">
                      <Copy size={13} />
                    </button>
                    {t.status !== 'published' && (
                      <button id={`tpl-publish-${t.id}`} onClick={() => handlePublish(t.id)}
                        title="Publish" className="p-1.5 rounded text-zinc-500 hover:text-emerald-400 hover:bg-emerald-400/10 transition-colors">
                        <CheckCircle2 size={13} />
                      </button>
                    )}
                    {!t.isDefault && t.status === 'published' && (
                      <button id={`tpl-setdefault-${t.id}`} onClick={() => handleSetDefault(t.id)}
                        title="Set as Default" className="p-1.5 rounded text-zinc-500 hover:text-yellow-400 hover:bg-yellow-400/10 transition-colors">
                        <Star size={13} />
                      </button>
                    )}
                    {t.status !== 'archived' && (
                      <button id={`tpl-archive-${t.id}`} onClick={() => handleArchive(t.id)}
                        title="Archive" className="p-1.5 rounded text-zinc-500 hover:text-orange-400 hover:bg-orange-400/10 transition-colors">
                        <Archive size={13} />
                      </button>
                    )}
                    <button id={`tpl-export-${t.id}`} onClick={() => handleExport(t)}
                      title="Export" className="p-1.5 rounded text-zinc-500 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors">
                      <Download size={13} />
                    </button>
                    {!t.isDefault && (
                      <button id={`tpl-delete-${t.id}`} onClick={() => handleDelete(t.id)}
                        title="Delete" className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </TableEl>
      </div>

      {/* Dialogs */}
      <TemplateEditorDialog
        open={editorOpen}
        template={editTarget}
        printers={printers}
        onClose={() => setEditorOpen(false)}
        onSaved={() => { setEditorOpen(false); load() }}
      />
      <TemplatePreviewDialog open={previewOpen} template={previewTarget} onClose={() => setPreviewOpen(false)} />
      <PrintHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} />

      {/* Printer Assignment Dialog */}
      <Dialog open={assignOpen} onOpenChange={v => !v && setAssignOpen(false)}>
        <DialogContent className="max-w-lg bg-zinc-900 border-zinc-700 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Settings2 size={16} className="text-indigo-400" /> Printer Template Assignments
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-xs">
              Assign a specific label template to each printer. Leaves the assignment empty to use the system default.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {printers.map(p => {
              const code = p.printerCode ?? p.PrinterCode
              return (
                <div key={code} className="flex items-center gap-3 bg-zinc-800/40 border border-zinc-700/50 rounded-lg p-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-200 truncate">{p.displayName ?? p.DisplayName}</div>
                    <div className="text-xs text-zinc-500 font-mono">{code}</div>
                  </div>
                  <Select value={assignSelections[code] ?? 'none'} onValueChange={v => setAssignSelections(prev => ({ ...prev, [code]: v }))}>
                    <SelectTrigger id={`assign-${code}`} className="w-52 h-8 text-xs bg-zinc-800 border-zinc-700 text-zinc-100">
                      <SelectValue placeholder="Use system default" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700 text-zinc-100">
                      <SelectItem value="none">— System Default —</SelectItem>
                      {templates.filter(t => t.status === 'published').map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            })}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setAssignOpen(false)} className="text-zinc-400 h-8 text-sm">Cancel</Button>
            <Button id="assign-save-btn" onClick={handleSaveAssignments} disabled={assignSaving}
              className="bg-indigo-600 hover:bg-indigo-500 h-8 text-sm">
              {assignSaving ? <RefreshCw size={12} className="animate-spin mr-1" /> : null}
              Save Assignments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default LabelTemplatesTab
