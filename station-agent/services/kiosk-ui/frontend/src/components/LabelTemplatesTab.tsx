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
  const color = status === 'published' ? 'bg-success/10 text-success border-success/20'
    : status === 'draft' ? 'bg-muted text-muted-foreground border-border'
    : 'bg-destructive/10 text-destructive border-destructive/20'
  const label = status === 'published' ? 'Published' : status === 'draft' ? 'Draft' : 'Archived'
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
        {label}
      </span>
      {isDefault && (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-info/10 text-info border-info/20">
          <Star size={11} className="fill-current" /> Default
        </span>
      )}
    </div>
  )
}

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  PRODUCT:    { label: 'Product',    color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20' },
  WIP:        { label: 'WIP',        color: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20' },
  PALLET:     { label: 'Pallet',     color: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20' },
  SHELF:      { label: 'Shelf',      color: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20' },
  INSPECTION: { label: 'Inspection', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  MATERIAL:   { label: 'Material',   color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' },
  SHEET:      { label: 'Sheet',      color: 'bg-lime-500/10 text-lime-600 dark:text-lime-400 border-lime-500/20' },
  ISSUE:      { label: 'Issue',      color: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' },
}

function CategoryBadge({ category }: { category?: string }) {
  if (!category) return null
  const meta = CATEGORY_META[category.toUpperCase()] ?? { label: category, color: 'bg-muted text-muted-foreground border-border' }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${meta.color}`}>
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

  const tryParseJson = (text: string) => {
    try {
      const p = JSON.parse(text)
      setParsedJson(p); setJsonError(null)
    } catch (e: any) {
      setParsedJson(null); setJsonError(e.message)
    }
  }

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
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col bg-card border-border text-foreground">
        <DialogHeader className="pb-2 border-b border-border">
          <DialogTitle className="text-lg font-semibold">
            {isEdit ? `Chỉnh sửa Mẫu — ${template?.name}` : 'Thêm Mẫu nhãn mới'}
          </DialogTitle>
          <DialogDescription className="text-muted-fg text-xs">
            {isEdit ? `Phiên bản v${template?.version} · Trạng thái: ${template?.status}` : 'Cấu hình thông số và thiết kế layout tem nhãn'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden grid grid-cols-2 gap-6 py-4 min-h-0">
          {/* Left — Form */}
          <div className="overflow-y-auto pr-2 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-semibold text-muted-fg mb-1 block">Tên mẫu tem (Template Name) *</label>
                <Input id="tpl-name" value={name} onChange={e => setName(e.target.value)}
                  placeholder="50x30 QR Label" className="bg-background border-border text-foreground h-9 text-sm focus-visible:ring-brand" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold text-muted-fg mb-1 block">Mô tả (Description)</label>
                <Input id="tpl-desc" value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Mô tả ngắn về mẫu tem..." className="bg-background border-border text-foreground h-9 text-sm focus-visible:ring-brand" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold text-muted-fg mb-1 block">Ghi chú sản xuất (Note)</label>
                <textarea
                  id="tpl-note"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={3}
                  placeholder="Ghi chú cho kỹ sư sản xuất: mục đích sử dụng, công đoạn áp dụng, yêu cầu máy in..."
                  className="w-full rounded-lg bg-background border border-border text-foreground text-sm px-3 py-2 resize-y focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-fg mb-1 block">Độ phân giải (DPI)</label>
                <Select value={dpi} onValueChange={setDpi}>
                  <SelectTrigger id="tpl-dpi" className="bg-background border-border text-foreground h-9 text-sm focus:ring-brand">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground">
                    <SelectItem value="203">203 DPI</SelectItem>
                    <SelectItem value="300">300 DPI</SelectItem>
                    <SelectItem value="600">600 DPI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <label className="text-xs font-semibold text-muted-fg mb-1 block">Rộng (W mm)</label>
                  <Input id="tpl-width" value={width} onChange={e => setWidth(e.target.value)} type="number"
                    className="bg-background border-border text-foreground h-9 text-sm focus-visible:ring-brand" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-fg mb-1 block">Cao (H mm)</label>
                  <Input id="tpl-height" value={height} onChange={e => setHeight(e.target.value)} type="number"
                    className="bg-background border-border text-foreground h-9 text-sm focus-visible:ring-brand" />
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-muted-fg">Cấu trúc mẫu nhãn (Template JSON)</label>
                {jsonError && <span className="text-error text-[10px] flex items-center gap-1 font-bold"><AlertTriangle size={10} />{jsonError.slice(0, 60)}</span>}
              </div>
              <textarea
                id="tpl-json"
                value={jsonText}
                onChange={e => handleJsonChange(e.target.value)}
                className={`w-full h-64 bg-background border rounded-lg text-xs font-mono p-3 text-foreground resize-none outline-none focus:ring-1 ${jsonError ? 'border-error focus:ring-error/40' : 'border-border focus:ring-brand/40'}`}
                spellCheck={false}
              />
            </div>

            {/* Test print (edit mode only) */}
            {isEdit && (
              <div className="bg-surface-2 border border-border rounded-xl p-4 space-y-3">
                <div className="text-xs font-bold text-foreground">In thử nghiệm (Test Print)</div>
                <div className="flex gap-3">
                  <Select value={testPrinter} onValueChange={setTestPrinter}>
                    <SelectTrigger id="tpl-test-printer" className="bg-background border-border text-foreground h-9 text-sm flex-1 focus:ring-brand">
                      <SelectValue placeholder="Chọn máy in..." />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border text-foreground">
                      {printers.map(p => (
                        <SelectItem key={p.printerCode ?? p.PrinterCode} value={p.printerCode ?? p.PrinterCode}>
                          {p.displayName ?? p.DisplayName} ({p.printerCode ?? p.PrinterCode})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button id="tpl-test-print-btn" size="sm" onClick={handleTestPrint} disabled={testing}
                    className="bg-info hover:bg-info/90 active:bg-info/85 text-white h-9 px-4 text-xs font-semibold shadow-sm rounded-lg">
                    {testing ? <RefreshCw size={14} className="animate-spin mr-1.5" /> : <PrinterIcon size={14} className="mr-1.5" />}
                    Test Print
                  </Button>
                </div>
                {testResult && (
                  <div className={`text-xs flex items-center gap-1.5 font-bold ${testResult.success ? 'text-success' : 'text-error'}`}>
                    {testResult.success ? <Check size={14} /> : <AlertTriangle size={14} />}
                    {testResult.msg}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right — Live Preview */}
          <div className="overflow-y-auto space-y-3 flex flex-col">
            <div className="text-xs font-semibold text-muted-fg mb-1">Xem trước trực quan (Live Preview)</div>
            <div className="bg-background border border-border rounded-xl p-4 flex items-center justify-center min-h-40 flex-1">
              {parsedJson ? (
                <LabelPreview
                  template={parsedJson as any}
                  data={{ serial_number: 'SN-TEST-001', product_code: 'P-TEST-01', product_name: 'Test Product', batch_number: 'BATCH-01', revision: 'A', production_date: new Date().toISOString().split('T')[0] }}
                  width={360}
                />
              ) : (
                <div className="text-muted-fg text-xs italic">Cấu trúc JSON bị lỗi, sửa lỗi để xem trước.</div>
              )}
            </div>
            <div className="text-[11px] text-muted-fg text-center italic">
              * Bản xem trước sử dụng dữ liệu mẫu. Kết quả in thực tế phụ thuộc vào máy in vật lý.
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-2 text-error text-xs font-semibold flex items-center gap-2 bg-error/10 border border-error/20 rounded-lg px-4 py-2.5">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        <DialogFooter className="mt-3 gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={onClose} className="text-muted-fg hover:text-foreground hover:bg-surface-2 h-9 text-sm font-semibold">Hủy</Button>
          <Button id="tpl-save-btn" onClick={handleSave} disabled={saving || !!jsonError}
            className="bg-brand hover:bg-brand-light active:bg-brand-dark text-white h-9 px-4 text-sm font-semibold rounded-lg shadow-sm">
            {saving ? <RefreshCw size={14} className="animate-spin mr-1.5" /> : null}
            {isEdit ? 'Lưu thay đổi' : 'Tạo mẫu nhãn'}
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
      <DialogContent className="max-w-2xl bg-card border-border text-foreground">
        <DialogHeader className="border-b border-border pb-2">
          <DialogTitle className="text-base font-semibold">{template?.name}</DialogTitle>
          <DialogDescription className="text-muted-fg text-xs">
            v{template?.version} · {template?.labelWidth}×{template?.labelHeight}mm · {template?.dpi} DPI
            {template?.orientation && ` · ${template.orientation}`}
            {template?.revision && ` · Rev ${template.revision}`}
          </DialogDescription>
        </DialogHeader>
        {/* Metadata row */}
        {(template?.category || template?.templateCode) && (
          <div className="flex items-center gap-2 flex-wrap pt-2">
            {template?.category && <CategoryBadge category={template.category} />}
            {template?.templateCode && (
              <span className="font-mono text-xs text-foreground bg-surface-2 px-2.5 py-0.5 rounded border border-border">
                Mã mẫu: {template.templateCode}
              </span>
            )}
            {template?.supportedBarcodeTypes && (
              <span className="text-xs text-muted-fg font-medium">
                {(() => { try { return (JSON.parse(template.supportedBarcodeTypes) as string[]).join(' · ') } catch { return template.supportedBarcodeTypes } })()}
              </span>
            )}
          </div>
        )}
        {/* Note — Ghi chú sản xuất */}
        {template?.note && (
          <div className="rounded-xl border border-warning/20 bg-warning/5 px-4 py-3">
            <div className="text-xs font-bold text-warning uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <span>📋</span> Ghi chú sản xuất
            </div>
            <pre className="text-xs text-foreground whitespace-pre-wrap leading-relaxed font-sans font-medium">
              {template.note}
            </pre>
          </div>
        )}
        <div className="flex items-center justify-center py-6 bg-background border border-border rounded-xl">
          {template && (
            <LabelPreview
              template={template.templateJson as any}
              data={{ serial_number: 'SN-PREVIEW-001', product_code: 'P-PREVIEW-01', product_name: 'Preview Product', batch_number: 'BATCH-PREVIEW', revision: 'B', production_date: new Date().toISOString().split('T')[0] }}
              width={460}
            />
          )}
        </div>
        {template?.description && (
          <p className="text-xs text-muted-fg italic px-1">{template.description}</p>
        )}
        <DialogFooter className="border-t border-border pt-3">
          <Button variant="ghost" onClick={onClose} className="text-muted-fg hover:text-foreground hover:bg-surface-2 h-9 text-sm font-semibold">Đóng</Button>
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
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col bg-card border-border text-foreground">
        <DialogHeader className="border-b border-border pb-2">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <History size={16} className="text-info" /> Lịch sử in/khắc tem nhãn (Print History)
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-fg text-sm">
              <RefreshCw size={18} className="animate-spin mr-2 text-brand" /> Đang tải lịch sử in…
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-16 text-muted-fg text-sm">Chưa có lịch sử in.</div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                {records.map(r => (
                  <div key={r.id}
                    onClick={() => setSelected(r)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all duration-200 text-xs ${selected?.id === r.id ? 'border-brand/40 bg-brand/5 shadow-sm' : 'border-border bg-surface-2 hover:border-border-strong hover:bg-surface-3/50'}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-foreground truncate max-w-[60%]">{r.templateName}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.status === 'SUCCESS' ? 'bg-success/10 text-success border border-success/20' : r.status === 'FAILED' ? 'bg-error/10 text-error border border-error/20' : 'bg-warning/10 text-warning border border-warning/20'}`}>
                        {r.status}
                      </span>
                    </div>
                    <div className="text-muted-fg flex gap-3 font-medium">
                      <span>Phiên bản: v{r.templateVersion}</span>
                      <span>Mã máy in: {r.printerCode}</span>
                      <span>Thời gian in: {r.durationMs}ms</span>
                    </div>
                    <div className="text-subtle-fg mt-1 font-mono text-[10px]">{new Date(r.createdAt).toLocaleString('vi-VN')}</div>
                  </div>
                ))}
              </div>
              <div className="sticky top-0">
                {selected ? (
                  <div className="bg-surface-2 border border-border rounded-xl p-4 space-y-3">
                    <div className="text-sm font-bold text-foreground mb-2">Chi tiết bản ghi in — {selected.templateName}</div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-fg font-medium">
                      <span>Trạng thái:</span><span className="text-foreground font-semibold">{selected.status}</span>
                      <span>Phiên bản:</span><span className="text-foreground">{selected.templateVersion}</span>
                      <span>Mã máy in:</span><span className="text-foreground">{selected.printerCode}</span>
                      <span>Thời gian xử lý:</span><span className="text-foreground">{selected.durationMs} ms</span>
                      <span>Trace ID:</span><span className="text-foreground font-mono text-[10px] truncate">{selected.traceId}</span>
                    </div>
                    {selected.renderedZpl && (
                      <div>
                        <div className="text-xs font-semibold text-muted-fg mb-1.5">Bản tin ZPL chi tiết</div>
                        <pre className="text-[11px] font-mono bg-background text-foreground p-3 rounded-lg max-h-48 overflow-y-auto border border-border">
                          {selected.renderedZpl}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-muted-fg text-xs text-center py-16 italic border border-dashed border-border rounded-xl bg-surface-2">Chọn một bản tin để xem chi tiết thông số in.</div>
                )}
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="border-t border-border pt-3">
          <Button variant="ghost" onClick={onClose} className="text-muted-fg hover:text-foreground hover:bg-surface-2 h-9 text-sm font-semibold">Đóng</Button>
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
    <div className="space-y-6 p-4 bg-background min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap pb-4 border-b border-border">
        <div>
          <h1 className="text-[32px] font-bold text-foreground flex items-center gap-3">
            <FileText size={32} className="text-brand" /> Mẫu nhãn thiết kế
          </h1>
          <p className="text-xs text-muted-fg mt-1">Quản lý và cấu hình mẫu tem nhãn, gán máy in tương thích ({templates.length} mẫu nhãn hoạt động)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button id="tpl-history-btn" variant="outline" size="sm" onClick={() => setHistoryOpen(true)}
            className="text-muted-fg hover:text-foreground h-10 px-4 text-sm font-semibold border-border hover:bg-surface-2 gap-2">
            <History size={16} /> Lịch sử in
          </Button>
          <Button id="tpl-assign-btn" variant="outline" size="sm" onClick={() => setAssignOpen(true)}
            className="text-muted-fg hover:text-foreground h-10 px-4 text-sm font-semibold border-border hover:bg-surface-2 gap-2">
            <Settings2 size={16} /> Phân bổ máy in
          </Button>
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <Button id="tpl-import-btn" variant="outline" size="sm" onClick={() => importRef.current?.click()}
            className="text-muted-fg hover:text-foreground h-10 px-4 text-sm font-semibold border-border hover:bg-surface-2 gap-2">
            <Upload size={16} /> Nhập file
          </Button>
          <Button id="tpl-new-btn" size="sm" onClick={() => { setEditTarget(null); setEditorOpen(true) }}
            className="bg-brand hover:bg-brand-light active:bg-brand-dark text-white h-10 px-4 text-sm font-semibold gap-2 shadow-sm rounded-lg">
            <Plus size={16} /> Thêm mẫu mới
          </Button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="flex items-center gap-3 bg-card p-4 rounded-xl border border-border shadow-sm flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
          <Input id="tpl-search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Tìm kiếm mẫu nhãn…" className="pl-10 h-10 text-sm bg-background border-border text-foreground placeholder:text-muted-fg focus-visible:ring-brand" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-muted-fg whitespace-nowrap">Phân loại:</span>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger id="tpl-category-filter" className="w-44 h-10 text-sm bg-background border-border text-foreground focus:ring-brand">
              <SelectValue placeholder="Tất cả nhóm" />
            </SelectTrigger>
            <SelectContent className="bg-card border-border text-foreground">
              <SelectItem value="all">Tất cả nhóm</SelectItem>
              {Object.entries(CATEGORY_META).map(([key, meta]) => (
                <SelectItem key={key} value={key}>{meta.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-muted-fg whitespace-nowrap">Trạng thái:</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger id="tpl-status-filter" className="w-44 h-10 text-sm bg-background border-border text-foreground focus:ring-brand">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-card border-border text-foreground">
              <SelectItem value="all">Tất cả trạng thái</SelectItem>
              <SelectItem value="published">Đã phát hành</SelectItem>
              <SelectItem value="draft">Bản nháp</SelectItem>
              <SelectItem value="archived">Đã lưu trữ</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button id="tpl-refresh-btn" variant="outline" size="icon" onClick={load} disabled={loading}
          className="text-muted-fg hover:text-foreground h-10 w-10 border-border hover:bg-surface-2">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
        <TableEl>
          <TableHeader>
            <TableRow className="border-border bg-surface-2 hover:bg-surface-2">
              <TableHead className="text-foreground text-sm font-semibold h-12 pl-6">Tên mẫu nhãn (Name)</TableHead>
              <TableHead className="text-foreground text-sm font-semibold h-12">Phân loại (Category)</TableHead>
              <TableHead className="text-foreground text-sm font-semibold h-12">Kích thước (Size)</TableHead>
              <TableHead className="text-foreground text-sm font-semibold h-12">Độ phân giải (DPI)</TableHead>
              <TableHead className="text-foreground text-sm font-semibold h-12">Phiên bản (Ver.)</TableHead>
              <TableHead className="text-foreground text-sm font-semibold h-12">Trạng thái (Status)</TableHead>
              <TableHead className="text-foreground text-sm font-semibold h-12">Cập nhật (Updated)</TableHead>
              <TableHead className="text-foreground text-sm font-semibold h-12 pr-6 text-right">Thao tác (Actions)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow className="border-border hover:bg-transparent">
                <TableCell colSpan={8} className="text-center py-16 text-muted-fg text-[15px]">
                  <RefreshCw size={18} className="animate-spin inline mr-2 text-brand" />Đang tải danh sách mẫu nhãn…
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow className="border-border hover:bg-transparent">
                <TableCell colSpan={8} className="text-center py-16 text-muted-fg text-[15px]">
                  Không tìm thấy mẫu nhãn nào phù hợp.
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.map(t => (
              <TableRow key={t.id} className="border-border hover:bg-surface-2/60 transition-colors">
                <TableCell className="pl-6 py-4">
                  <div className="font-semibold text-foreground text-[15px]">{t.name}</div>
                  {t.templateCode && (
                    <div className="font-mono text-xs text-muted-fg mt-1">{t.templateCode}</div>
                  )}
                  {t.description && <div className="text-muted-fg text-xs mt-0.5 truncate max-w-xs">{t.description}</div>}
                </TableCell>
                <TableCell className="py-4">
                  <CategoryBadge category={t.category} />
                </TableCell>
                <TableCell className="py-4 text-[15px] text-foreground font-mono">{t.labelWidth} × {t.labelHeight} mm</TableCell>
                <TableCell className="py-4 text-[15px] text-muted-fg font-mono">{t.dpi} DPI</TableCell>
                <TableCell className="py-4 text-[15px] text-muted-fg font-mono">v{t.version}</TableCell>
                <TableCell className="py-4"><TemplateBadge status={t.status} isDefault={t.isDefault} /></TableCell>
                <TableCell className="py-4 text-[15px] text-muted-fg">{new Date(t.updatedAt).toLocaleDateString('vi-VN')}</TableCell>
                <TableCell className="pr-6 py-4">
                  <div className="flex items-center gap-1 justify-end">
                    <button id={`tpl-preview-${t.id}`} onClick={() => { setPreviewTarget(t); setPreviewOpen(true) }}
                      title="Xem trước" className="p-2 rounded-lg text-muted-fg hover:text-blue-600 hover:bg-blue-500/10 transition-all duration-200">
                      <Eye size={16} />
                    </button>
                    <button id={`tpl-edit-${t.id}`} onClick={() => { setEditTarget(t); setEditorOpen(true) }}
                      title="Chỉnh sửa" className="p-2 rounded-lg text-muted-fg hover:text-brand hover:bg-brand/10 transition-all duration-200">
                      <Edit2 size={16} />
                    </button>
                    <button id={`tpl-dup-${t.id}`} onClick={() => handleDuplicate(t.id)}
                      title="Nhân bản" className="p-2 rounded-lg text-muted-fg hover:text-amber-600 hover:bg-amber-500/10 transition-all duration-200">
                      <Copy size={16} />
                    </button>
                    {t.status !== 'published' && (
                      <button id={`tpl-publish-${t.id}`} onClick={() => handlePublish(t.id)}
                        title="Phát hành" className="p-2 rounded-lg text-muted-fg hover:text-emerald-600 hover:bg-emerald-500/10 transition-all duration-200">
                        <CheckCircle2 size={16} />
                      </button>
                    )}
                    {!t.isDefault && t.status === 'published' && (
                      <button id={`tpl-setdefault-${t.id}`} onClick={() => handleSetDefault(t.id)}
                        title="Đặt làm Mặc định" className="p-2 rounded-lg text-muted-fg hover:text-yellow-600 hover:bg-yellow-500/10 transition-all duration-200">
                        <Star size={16} />
                      </button>
                    )}
                    {t.status !== 'archived' && (
                      <button id={`tpl-archive-${t.id}`} onClick={() => handleArchive(t.id)}
                        title="Lưu trữ" className="p-2 rounded-lg text-muted-fg hover:text-orange-600 hover:bg-orange-500/10 transition-all duration-200">
                        <Archive size={16} />
                      </button>
                    )}
                    <button id={`tpl-export-${t.id}`} onClick={() => handleExport(t)}
                      title="Xuất file" className="p-2 rounded-lg text-muted-fg hover:text-cyan-600 hover:bg-cyan-500/10 transition-all duration-200">
                      <Download size={16} />
                    </button>
                    {!t.isDefault && (
                      <button id={`tpl-delete-${t.id}`} onClick={() => handleDelete(t.id)}
                        title="Xóa" className="p-2 rounded-lg text-muted-fg hover:text-red-600 hover:bg-red-500/10 transition-all duration-200">
                        <Trash2 size={16} />
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
        <DialogContent className="max-w-lg bg-card border-border text-foreground">
          <DialogHeader className="border-b border-border pb-2">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Settings2 size={16} className="text-brand" /> Cấu hình Phân bổ Mẫu nhãn in
            </DialogTitle>
            <DialogDescription className="text-muted-fg text-xs">
              Gán mẫu nhãn in cụ thể cho từng thiết bị máy in. Bỏ trống để sử dụng mẫu mặc định của hệ thống.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            {printers.map(p => {
              const code = p.printerCode ?? p.PrinterCode
              return (
                <div key={code} className="flex items-center gap-4 bg-surface-2 border border-border rounded-xl p-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-foreground truncate">{p.displayName ?? p.DisplayName}</div>
                    <div className="text-xs text-muted-fg font-mono mt-0.5">Mã thiết bị: {code}</div>
                  </div>
                  <Select value={assignSelections[code] ?? 'none'} onValueChange={v => setAssignSelections(prev => ({ ...prev, [code]: v }))}>
                    <SelectTrigger id={`assign-${code}`} className="w-56 h-10 text-sm bg-background border-border text-foreground focus:ring-brand">
                      <SelectValue placeholder="Mặc định hệ thống" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border text-foreground">
                      <SelectItem value="none">— Mặc định hệ thống —</SelectItem>
                      {templates.filter(t => t.status === 'published').map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            })}
          </div>
          <DialogFooter className="gap-2 border-t border-border pt-3">
            <Button variant="ghost" onClick={() => setAssignOpen(false)} className="text-muted-fg hover:text-foreground hover:bg-surface-2 h-9 text-sm font-semibold">Hủy</Button>
            <Button id="assign-save-btn" onClick={handleSaveAssignments} disabled={assignSaving}
              className="bg-brand hover:bg-brand-light active:bg-brand-dark text-white h-9 px-4 text-sm font-semibold rounded-lg shadow-sm">
              {assignSaving ? <RefreshCw size={14} className="animate-spin mr-1.5" /> : null}
              Lưu phân bổ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default LabelTemplatesTab

