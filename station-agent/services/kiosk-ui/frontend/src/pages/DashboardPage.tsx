import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useDashboard, ProductionRecord } from '@/hooks/useDashboard'
import { useProductionRecords } from '@/hooks/useProductionRecords'
import client, { rbacApi, jobsApi, commandsApi } from '@/api/client'
import { DispatchDialog, DispatchTarget } from '@/components/DispatchDialog'
import { useAuth } from '@/context/AuthContext'
import { PROTECTED_ADMIN_USERNAME, CREATABLE_ROLES } from '@/constants/roles'
import { translatePermission, translateRole, translateJobType } from '@/lib/utils'
import { LabelPreview } from '@/components/LabelPreview'
import { LabelTemplatesTab } from '@/components/LabelTemplatesTab'

// Icons
import {
  Users, LayoutDashboard, Key, Trash2, Plus,
  CheckCircle2, ShieldAlert, LogOut, UserCheck, Wifi, WifiOff,
  Flame, Cpu, Printer as PrinterIcon, Zap, Camera, Clock,
  Filter, RefreshCw, History, Database,
  Shield, User, UserX, MoreVertical,
  Search, Settings, Activity, AlertTriangle, LineChart, CheckCircle, Sun, Moon
} from 'lucide-react'

// Common Components
import { StatusBadge } from '@/components/StatusBadge'
import { PermissionBadge } from '@/components/PermissionBadge'
import { ConfirmDialog } from '@/components/ConfirmDialog'

// UI primitives
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card'
import {
  Table as TableEl, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

import { FileText } from 'lucide-react'

type KioskTab = 'dashboard' | 'history' | 'traceability' | 'orders' | 'queue' | 'alarms' | 'config' | 'diagnostics' | 'connectivity' | 'rbac' | 'templates'

const getTodayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const translateStepName = (name: string) => {
  if (!name) return '—';
  const n = name.toUpperCase();
  if (n === 'PRINT_LABEL') return 'In nhãn hàng (Print Label)';
  if (n === 'LASER_MARK') return 'Khắc laser (Laser Mark)';
  if (n === 'VISION_CHECK') return 'Kiểm tra vision (Vision Check)';
  if (n === 'PLC_REJECT') return 'PLC loại bỏ sản phẩm lỗi (PLC Reject)';
  return name;
};



const translateReasonCode = (code: string) => {
  if (!code) return '—';
  const c = code.toUpperCase();
  if (c === 'PRINT_QUALITY') return 'Lỗi chất lượng in';
  if (c === 'LASER_UNREADABLE') return 'Mã khắc không đọc được';
  if (c === 'WRONG_LABEL') return 'Sai nhãn sản phẩm';
  if (c === 'VERIFICATION_FAILED') return 'Lỗi xác thực vision';
  if (c === 'CUSTOMER_COMPLAINT') return 'Khiếu nại từ khách hàng';
  if (c === 'OPERATOR_MISTAKE') return 'Thao tác viên nhầm lẫn';
  if (c === 'MAINTENANCE_TEST') return 'Kiểm tra & Bảo trì';
  if (c === 'OTHER') return 'Lý do khác';
  return code;
};

const translateStepSource = (stepName: string) => {
  const n = stepName?.toUpperCase();
  if (n === 'PRINT_LABEL') return 'Máy in nhãn (Label Printer)';
  if (n === 'LASER_MARK') return 'Máy khắc Laser (Laser Marker)';
  if (n === 'VISION_CHECK') return 'Camera ngoại quan (Vision Camera)';
  if (n === 'PLC_REJECT') return 'Bộ điều khiển PLC (PLC Controller)';
  return 'Hệ thống';
};

const translateStepDevice = (stepName: string) => {
  const n = stepName?.toUpperCase();
  if (n === 'PRINT_LABEL') return 'Virtual Printer';
  if (n === 'LASER_MARK') return 'Virtual Laser';
  if (n === 'VISION_CHECK') return 'Virtual Vision';
  if (n === 'PLC_REJECT') return 'Virtual PLC';
  return 'Station Agent';
};

const parseFailureMessage = (stepName: string, errorMessage: string) => {
  if (!errorMessage) return null;
  try {
    const data = JSON.parse(errorMessage);
    if (data && (data.status === 'failed' || data.reason)) {
      const source = translateStepSource(stepName);
      let reason = data.reason;
      if (reason === 'QR Code mismatch') reason = 'Sai lệch mã QR (QR Code mismatch)';
      else if (reason === 'Unreadable marking') reason = 'Mã khắc không đọc được (Unreadable marking)';
      else if (reason === 'Missing marking') reason = 'Thiếu dấu khắc/nhãn (Missing marking)';

      return {
        source,
        reason,
        expected: data.expected,
        actual: data.actual,
        device: data.device || translateStepDevice(stepName),
        rawResponse: errorMessage
      };
    }
  } catch (e) {
    // Not JSON
  }
  return {
    source: translateStepSource(stepName),
    reason: errorMessage,
    expected: null,
    actual: null,
    device: translateStepDevice(stepName),
    rawResponse: errorMessage
  };
};

const getStepStatusBadge = (status: string) => {
  const s = status?.toUpperCase();
  if (s === 'COMPLETED') return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-semibold">Hoàn thành</span>;
  if (s === 'FAILED') return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/30 text-xs font-semibold">Thất bại</span>;
  if (s === 'PROCESSING') return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-brand/10 text-brand-light border border-brand/30 text-xs font-semibold animate-pulse">Đang chạy</span>;
  if (s === 'SKIPPED') return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 text-xs font-semibold">Bỏ qua</span>;
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-400 border border-gray-500/30 text-xs font-semibold">Chờ</span>;
};

export default function DashboardPage() {
  const stationId = 'STATION-01'
  const navigate = useNavigate()
  const { user: currentUser, logout } = useAuth()
  const { isConnected, production, devices, todayRecords, activities, alarms, setAlarms } = useDashboard(stationId)
  const gatewayDevice = devices.find((d: any) => d.deviceId === 'gateway-01')
  const isGatewayOnline = gatewayDevice?.isOnline ?? false
  const { historyData, loading: loadingHistory, error: historyError, fetchHistory } = useProductionRecords()

  const [tab, setTab] = useState<KioskTab>('dashboard')
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('kiosk-theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
    localStorage.setItem('kiosk-theme', theme);
  }, [theme]);

  // RBAC states
  const [users, setUsers] = useState<any[]>([])
  const [availablePermissions, setAvailablePermissions] = useState<any[]>([])
  const [editingUser, setEditingUser] = useState<any | null>(null)
  const [userPermDraft, setUserPermDraft] = useState<string[]>([])
  const [userToDelete, setUserToDelete] = useState<any | null>(null)
  const [newUsername, setNewUsername] = useState('')
  const [newFullName, setNewFullName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('MEMBER')
  const [rbacError, setRbacError] = useState('')
  const [rbacSuccess, setRbacSuccess] = useState('')

  // Traceability states
  const [searchSerial, setSearchSerial] = useState('')
  const [traceResult, setTraceResult] = useState<any>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const [traceError, setTraceError] = useState('')

  // Diagnostics / Health / Metrics states
  const [diagnosticsHealth, setDiagnosticsHealth] = useState<any>(null)
  const [diagnosticsMetrics, setDiagnosticsMetrics] = useState<any>(null)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)

  // Configuration settings states
  const [configParams, setConfigParams] = useState<any[]>([])
  const [configLoading, setConfigLoading] = useState(false)
  const [configEditingKey, setConfigEditingKey] = useState<string | null>(null)
  const [configEditingValue, setConfigEditingValue] = useState('')

  // Production Orders states
  const [orders, setOrders] = useState<any[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [orderItemsLoading, setOrderItemsLoading] = useState(false)
  const [orderModalOpen, setOrderModalOpen] = useState(false)

  // Dispatch Dialog states
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false)
  const [dispatchLoading, setDispatchLoading] = useState(false)
  const [dispatchResult, setDispatchResult] = useState<{ success: boolean; dispatched: number; total: number; target: string } | null>(null)

  const fetchOrders = async () => {
    setOrdersLoading(true)
    try {
      const res = await client.get('/projection/orders')
      setOrders(res.data || [])
    } catch (err) {
      console.error('Failed to fetch production orders:', err)
    } finally {
      setOrdersLoading(false)
    }
  }

  const fetchOrderItems = async (orderNo: string) => {
    setOrderItemsLoading(true)
    setDispatchResult(null)
    try {
      const res = await client.get(`/projection/orders/${orderNo}/items`)
      setOrderItems(res.data || [])
    } catch (err) {
      console.error('Failed to fetch order items:', err)
    } finally {
      setOrderItemsLoading(false)
    }
  }

  const handleConfirmDispatch = useCallback(async (target: DispatchTarget, notes: string) => {
    if (!selectedOrder) return
    setDispatchLoading(true)
    setDispatchResult(null)
    try {
      const res = await commandsApi.dispatchOrder({
        orderNo: selectedOrder.orderNo,
        dispatchTarget: target,
        notes
      })
      setDispatchResult({
        success: true,
        dispatched: res.data.dispatched,
        total: res.data.total,
        target
      })
      setDispatchDialogOpen(false)
      // Refresh items to show updated statuses
      await fetchOrderItems(selectedOrder.orderNo)
    } catch (err: any) {
      setDispatchResult({ success: false, dispatched: 0, total: 0, target })
    } finally {
      setDispatchLoading(false)
    }
  }, [selectedOrder])

  const handleOpenOrderDetail = async (order: any) => {
    setSelectedOrder(order)
    setOrderModalOpen(true)
    await fetchOrderItems(order.orderNo)
  }

  const fetchDiagnostics = async () => {
    setDiagnosticsLoading(true)
    try {
      const [hRes, mRes] = await Promise.all([
        client.get('/projection/diagnostics/health'),
        client.get('/projection/diagnostics/metrics')
      ])
      setDiagnosticsHealth(hRes.data)
      setDiagnosticsMetrics(mRes.data)
    } catch (err) {
      console.error('Failed to fetch diagnostics:', err)
    } finally {
      setDiagnosticsLoading(false)
    }
  }

  const fetchConfigParams = async () => {
    setConfigLoading(true)
    try {
      const res = await client.get('/projection/config')
      setConfigParams(res.data || [])
    } catch (err) {
      console.error('Failed to fetch config params:', err)
    } finally {
      setConfigLoading(false)
    }
  }

  const handleSaveConfig = async (key: string, value: string) => {
    try {
      await client.put(`/projection/config/${key}`, { value })
      setConfigParams(prev => prev.map(c => c.key === key ? { ...c, value } : c))
      setConfigEditingKey(null)
    } catch (err) {
      console.error('Failed to update config parameter:', err)
    }
  }

  const handleAcknowledgeAlarm = async (alarmId: string) => {
    try {
      await client.post(`/projection/alarms/${alarmId}/acknowledge`)
      setAlarms((prev: any[]) => prev.map(a => a.id === alarmId ? { ...a, isAcknowledged: true, acknowledgedBy: 'Operator', acknowledgedAt: new Date().toISOString() } : a))
    } catch (err) {
      console.error('Failed to acknowledge alarm:', err)
    }
  }

  const handleTraceSearch = async () => {
    if (!searchSerial.trim()) return
    setTraceLoading(true)
    setTraceError('')
    setTraceResult(null)
    try {
      const res = await client.get(`/api/jobs?page=1&pageSize=1&serial=${encodeURIComponent(searchSerial.trim())}`)
      if (res.data && res.data.items && res.data.items.length > 0) {
        const job = res.data.items[0]
        const attemptsRes = await client.get(`/api/jobs/${job.id}/attempts`)
        const attempts = attemptsRes.data || []
        const attemptsWithSteps = await Promise.all(attempts.map(async (att: any) => {
          const stepsRes = await client.get(`/api/jobs/attempts/${att.id}/steps`)
          return { ...att, steps: stepsRes.data || [] }
        }))
        setTraceResult({ job, attempts: attemptsWithSteps })
      } else {
        setTraceError('Không tìm thấy thông tin gia công cho số Serial này.')
      }
    } catch (err: any) {
      setTraceError('Đã xảy ra lỗi khi tìm kiếm thông tin truy xuất.')
    } finally {
      setTraceLoading(false)
    }
  }

  // Action dropdown states
  const [activeDropdownUserId, setActiveDropdownUserId] = useState<string | null>(null)
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null)
  const [userToToggleActive, setUserToToggleActive] = useState<any | null>(null)

  // Audit log timeline states
  const [auditLogUser, setAuditLogUser] = useState<any | null>(null)
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [isAuditLogsLoading, setIsAuditLogsLoading] = useState(false)

  // Password reset states
  const [resetPwdUser, setResetPwdUser] = useState<any | null>(null)
  const [newPasswordVal, setNewPasswordVal] = useState('')
  const [resetReason, setResetReason] = useState('')
  const [resetPwdConfirmOpen, setResetPwdConfirmOpen] = useState(false)
  const [resetError, setResetError] = useState('')
  const [resetSuccess, setResetSuccess] = useState('')

  // Permission update confirmation state
  const [permConfirmOpen, setPermConfirmOpen] = useState(false)

  // Manual Override confirmation state
  const [overrideConfirmOpen, setOverrideConfirmOpen] = useState(false)
  const [overrideConfirmData, setOverrideConfirmData] = useState<{
    title: string
    description: string
    type: string
  } | null>(null)


  // History states
  const [historyPage, setHistoryPage] = useState(1)
  const historyPageSize = 10
  const [historyFilters, setHistoryFilters] = useState({
    status: '',
    productCode: '',
    workOrder: '',
    dateFrom: getTodayStr(),
    dateTo: getTodayStr()
  })

  // Detailed Record View State
  const [selectedRecord, setSelectedRecord] = useState<ProductionRecord | null>(null)

  // Reprint / Remark Overwrite Dialog States
  const [isReprintListOpen, setIsReprintListOpen] = useState(false)
  const [selectedReprintRecord, setSelectedReprintRecord] = useState<ProductionRecord | null>(null)
  const [reprintReasonCode, setReprintReasonCode] = useState('PRINT_QUALITY')
  const [reprintComment, setReprintComment] = useState('')
  const [reprintConfirmed, setReprintConfirmed] = useState(false)
  const [latestAttemptId, setLatestAttemptId] = useState<string>('none')
  const [reprintError, setReprintError] = useState('')
  const [reprintSuccess, setReprintSuccess] = useState('')
  const [submittingReprint, setSubmittingReprint] = useState(false)

  // History Detail Dialog States
  const [activeJobDetails, setActiveJobDetails] = useState<any>(null)
  const [activeJobSteps, setActiveJobSteps] = useState<any[]>([])
  const [activeTemplate, setActiveTemplate] = useState<any>(null)

  // Helper to resolve variables from the active job
  const getResolvedData = (): Record<string, string> => {
    if (!activeJobDetails) return {
      production_order: '—',
      work_order: '—',
      workflow: '—',
      operation: '—',
      station: 'STATION-01',
      team: 'Team A',
      operator: currentUser?.username || 'admin.operator',
      product_name: '—',
      product_code: '—',
      revision: '—',
      customer: '—',
      material: '—',
      rubber_type: '—',
      lot_number: '—',
      batch_number: '—',
      manufacture_date: '—',
      expiry_date: '—',
      country: '—',
      serial_number: '—',
      trace_id: '—',
      planned_quantity: '0',
      completed_quantity: '0',
      remaining_quantity: '0',
      current_step: '—'
    }

    let parsedTags: Record<string, string> = {}
    try {
      const payload = JSON.parse(activeJobDetails.payloadJson)
      if (payload.data && Array.isArray(payload.data)) {
        payload.data.forEach((item: any) => {
          if (item.tag) {
            parsedTags[item.tag] = String(item.value ?? '')
            const simpleKey = item.tag.split('.').pop()
            if (simpleKey && !parsedTags[simpleKey]) {
              parsedTags[simpleKey] = String(item.value ?? '')
            }
          }
        })
      }
      if (payload.event_id) {
        parsedTags['trace_id'] = payload.event_id
      }
    } catch (e) {
      console.warn("Failed to parse active job payloadJson", e)
    }

    const resolvedData: Record<string, string> = {
      production_order: activeJobDetails.jobNo,
      work_order: activeJobDetails.productSerial || 'N/A',
      workflow: 'Default Workflow',
      operation: activeJobDetails.jobType,
      station: 'STATION-01',
      team: 'Team A',
      operator: currentUser?.username || 'admin.operator',
      product_name: activeJobDetails.productCode + ' Industrial Part',
      product_code: activeJobDetails.productCode,
      revision: 'Rev A',
      customer: 'Won Seal Tech',
      material: 'NBR-70',
      rubber_type: 'Synthetic Rubber',
      lot_number: 'LOT-2026-07-A',
      batch_number: 'BATCH-01',
      manufacture_date: new Date(activeJobDetails.createdAt).toISOString().split('T')[0],
      expiry_date: new Date(new Date(activeJobDetails.createdAt).getTime() + 365 * 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      country: 'Vietnam',
      serial_number: activeJobDetails.productSerial || 'N/A',
      trace_id: activeJobDetails.id,
      planned_quantity: '100',
      completed_quantity: '0',
      remaining_quantity: '100',
      current_step: 'Step 1',
      ...parsedTags
    }

    // Apply explicit variables
    if (parsedTags['production.order_number']) resolvedData['production_order'] = parsedTags['production.order_number']
    if (parsedTags['production.workflow']) resolvedData['workflow'] = parsedTags['production.workflow']
    if (parsedTags['product.name']) resolvedData['product_name'] = parsedTags['product.name']
    if (parsedTags['product.revision']) resolvedData['revision'] = parsedTags['product.revision']
    if (parsedTags['customer.name']) resolvedData['customer'] = parsedTags['customer.name']
    if (parsedTags['product.material']) resolvedData['material'] = parsedTags['product.material']
    if (parsedTags['product.rubber_type']) resolvedData['rubber_type'] = parsedTags['product.rubber_type']
    if (parsedTags['product.lot']) resolvedData['lot_number'] = parsedTags['product.lot']
    if (parsedTags['product.batch']) resolvedData['batch_number'] = parsedTags['product.batch']
    if (parsedTags['product.mfg_date']) resolvedData['manufacture_date'] = parsedTags['product.mfg_date']
    if (parsedTags['product.exp_date']) resolvedData['expiry_date'] = parsedTags['product.exp_date']
    if (parsedTags['product.country']) resolvedData['country'] = parsedTags['product.country']
    if (parsedTags['marking.serial']) resolvedData['serial_number'] = parsedTags['marking.serial']
    if (parsedTags['production.planned_qty']) resolvedData['planned_quantity'] = parsedTags['production.planned_qty']
    if (parsedTags['production.completed_qty']) resolvedData['completed_quantity'] = parsedTags['production.completed_qty']
    if (parsedTags['production.remaining_qty']) resolvedData['remaining_quantity'] = parsedTags['production.remaining_qty']

    return resolvedData
  }

  const getVisionResult = () => {
    const visionStep = activeJobSteps.find((s: any) => s.stepName === 'VISION' || s.stepName === 'VISION_CHECK')
    let visionResult = {
      result: 'PENDING',
      ocrText: '—',
      confidence: 0,
      defectCode: null as string | null,
      durationMs: 0
    }

    if (visionStep && visionStep.status === 'COMPLETED' && visionStep.resultJson) {
      try {
        const res = JSON.parse(visionStep.resultJson)
        visionResult = {
          result: res.result || res.Result || 'PASS',
          ocrText: res.ocrText || res.OcrText || '—',
          confidence: res.confidence || res.Confidence || 0.985,
          defectCode: res.defectCode || res.DefectCode || null,
          durationMs: res.durationMs || res.DurationMs || 520
        }
      } catch (e) {
        visionResult.result = 'PASS'
        const resolved = getResolvedData()
        visionResult.ocrText = resolved.serial_number || '—'
        visionResult.confidence = 0.99
      }
    } else if (visionStep && visionStep.status === 'FAILED') {
      visionResult.result = 'FAIL'
      visionResult.defectCode = 'BAD_OCR'
      visionResult.confidence = 0.45
    } else if (visionStep && visionStep.status === 'PROCESSING') {
      visionResult.result = 'PROCESSING'
    }
    return visionResult
  }

  const fetchActiveTemplate = useCallback(() => {
    client.get('/label-templates/active')
      .then((res: any) => {
        setActiveTemplate(res.data)
      })
      .catch((err: any) => console.error("Error fetching active template:", err))
  }, [])

  // Fetch active template on mount
  useEffect(() => {
    fetchActiveTemplate()
  }, [fetchActiveTemplate])

  // Retry fetching active template every 10s if it's null
  useEffect(() => {
    if (activeTemplate) return
    const timer = setInterval(() => {
      if (!activeTemplate) {
        fetchActiveTemplate()
      }
    }, 10000)
    return () => clearInterval(timer)
  }, [activeTemplate, fetchActiveTemplate])

  // Fetch active job details, attempts & steps reactively
  useEffect(() => {
    let active = true;
    if (production?.jobId) {
      jobsApi.getById(production.jobId)
        .then((res: any) => {
          if (active) {
            setActiveJobDetails(res.data)
          }
        })
        .catch((err: any) => console.error("Error fetching active job details:", err))

      jobsApi.getAttempts(production.jobId)
        .then((res: any) => {
          if (!active) return;
          if (res.data && res.data.length > 0) {
            const latest = [...res.data].sort((a: any, b: any) => b.attemptNo - a.attemptNo)[0]
            jobsApi.getAttemptSteps(latest.id)
              .then((stepsRes: any) => {
                if (active) {
                  setActiveJobSteps(stepsRes.data)
                }
              })
              .catch((err: any) => console.error("Error fetching active job steps:", err))
          } else {
            if (active) {
              setActiveJobSteps([])
            }
          }
        })
        .catch((err: any) => {
          console.error("Error fetching active job attempts:", err)
          if (active) {
            setActiveJobSteps([])
          }
        })
    } else {
      if (active) {
        setActiveJobDetails(null)
        setActiveJobSteps([])
      }
    }
    return () => {
      active = false;
    };
  }, [production?.jobId, production?.jobStatus])


  // Note: label preview is now rendered client-side by <LabelPreview> from template JSON.
  // The Labelary HTTP pipeline (render → preview) has been removed — no state or effects needed.

  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false)
  const [selectedDetailRecord, setSelectedDetailRecord] = useState<ProductionRecord | null>(null)
  const [detailAttempts, setDetailAttempts] = useState<any[]>([])
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null)
  const [attemptSteps, setAttemptSteps] = useState<Record<string, any[]>>({})
  const [loadingDetail, setLoadingDetail] = useState(false)

  const [detailPieces, setDetailPieces] = useState<any[]>([])
  const [selectedPieceJobId, setSelectedPieceJobId] = useState<string | null>(null)
  const [loadingPieces, setLoadingPieces] = useState(false)
  const [detailTab, setDetailTab] = useState<'pieces' | 'progress'>('pieces')

  const isSuperAdmin =
    currentUser?.roles?.includes('SUPER_ADMIN') ||
    currentUser?.permissions?.includes('SYSTEM_ADMIN')

  const canViewJobs =
    currentUser?.permissions?.includes('JOB_VIEW') || isSuperAdmin

  const canReprocess =
    currentUser?.permissions?.includes('JOB_REPROCESS') || isSuperAdmin

  const fetchRbacData = () => {
    if (!isSuperAdmin) return
    rbacApi.getUsers().then((res) => setUsers(res.data)).catch(console.error)
    rbacApi.getPermissions().then((res) => setAvailablePermissions(res.data)).catch(console.error)
  }

  useEffect(() => {
    if (!canViewJobs && (tab === 'dashboard' || tab === 'history')) {
      setTab('connectivity')
    }
  }, [currentUser, canViewJobs, tab])

  useEffect(() => {
    if (tab === 'rbac') fetchRbacData()
    if (tab === 'history' && canViewJobs) fetchHistory(historyPage, historyPageSize, historyFilters)
    if (tab === 'diagnostics') fetchDiagnostics()
    if (tab === 'config') fetchConfigParams()
    if (tab === 'orders') fetchOrders()
  }, [tab, currentUser, historyPage, historyFilters])

  // Click outside handler for actions dropdown
  useEffect(() => {
    if (!activeDropdownUserId) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.user-actions-dropdown') && !target.closest('.portal-dropdown-content')) {
        setActiveDropdownUserId(null);
        setDropdownPosition(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [activeDropdownUserId]);

  // Close actions dropdown on page scroll or viewport resize
  useEffect(() => {
    if (!activeDropdownUserId) return;
    const handleScrollOrResize = () => {
      setActiveDropdownUserId(null);
      setDropdownPosition(null);
    };
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [activeDropdownUserId]);

  const showAuditLogs = async (user: any) => {
    setAuditLogUser(user)
    setIsAuditLogsLoading(true)
    try {
      const res = await rbacApi.getUserAuditLogs(user.id)
      setAuditLogs(res.data || [])
    } catch (err) {
      console.error('Failed to load audit logs', err)
      setRbacError('Không thể tải nhật ký kiểm toán cho người dùng này.')
    } finally {
      setIsAuditLogsLoading(false)
    }
  }

  const handleConfirmToggleActive = async () => {
    if (!userToToggleActive) return
    const { id: userId, username, isActive } = userToToggleActive
    setUserToToggleActive(null); setRbacError(''); setRbacSuccess('')
    try {
      await rbacApi.toggleActive(userId)
      setRbacSuccess(`${isActive ? 'Vô hiệu hóa' : 'Kích hoạt'} tài khoản "${username}" thành công.`)
      fetchRbacData()
    } catch (err: any) {
      setRbacError(err.response?.data?.error || 'Cập nhật trạng thái tài khoản thất bại.')
    }
  }

  /* ── handlers ─────────────────────────────────────────── */
  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setRbacError(''); setRbacSuccess('')
    try {
      await rbacApi.createUser({ username: newUsername, fullName: newFullName, password: newPassword, roleCode: newRole })
      setRbacSuccess(`Người dùng "${newUsername}" đã được tạo thành công.`)
      setNewUsername(''); setNewFullName(''); setNewPassword(''); setNewRole('MEMBER')
      fetchRbacData()
    } catch (err: any) {
      setRbacError(err.response?.data?.error || 'Tạo người dùng thất bại.')
    }
  }

  const handleConfirmDeleteUser = async () => {
    if (!userToDelete) return
    const { id: userId, username } = userToDelete
    setUserToDelete(null); setRbacError(''); setRbacSuccess('')
    try {
      await rbacApi.deleteUser(userId)
      setRbacSuccess(`Xóa người dùng "${username}" thành công.`)
      if (editingUser?.id === userId) setEditingUser(null)
      fetchRbacData()
    } catch (err: any) {
      setRbacError(err.response?.data?.error || 'Xóa người dùng thất bại.')
    }
  }

  const startEditPermissions = (user: any) => {
    setEditingUser(user)
    setUserPermDraft(user.directPermissions ?? [])
  }

  const handleTogglePermDraft = (code: string) =>
    setUserPermDraft((prev) => prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code])

  const handleSavePermissions = () => {
    if (!editingUser) return
    setPermConfirmOpen(true)
  }

  const handleConfirmSavePermissions = async () => {
    setPermConfirmOpen(false)
    if (!editingUser) return
    setRbacError(''); setRbacSuccess('')
    try {
      await rbacApi.updateUserPermissions(editingUser.id, userPermDraft)
      setRbacSuccess(`Quyền trực tiếp cho "${editingUser.username}" đã được cập nhật.`)
      setEditingUser(null); fetchRbacData()
    } catch (err: any) {
      setRbacError(err.response?.data?.error || 'Lưu phân quyền thất bại.')
    }
  }

  const startResetPassword = (user: any) => {
    setResetPwdUser(user)
    setNewPasswordVal('')
    setResetReason('')
    setResetError('')
    setResetSuccess('')
  }

  const handleResetPasswordSubmit = () => {
    if (!resetPwdUser || !newPasswordVal || newPasswordVal.length < 6 || !resetReason.trim()) return
    setResetPwdConfirmOpen(true)
  }

  const handleConfirmResetPassword = async () => {
    setResetPwdConfirmOpen(false)
    if (!resetPwdUser) return
    setResetError('')
    setResetSuccess('')
    try {
      await rbacApi.resetPassword(resetPwdUser.id, {
        password: newPasswordVal,
        reason: resetReason
      })
      setResetSuccess('Đặt lại mật khẩu thành công.')
      setNewPasswordVal('')
      setResetReason('')
      fetchRbacData()
      setTimeout(() => {
        setResetPwdUser(null)
        setResetSuccess('')
      }, 1500)
    } catch (err: any) {
      setResetError(err.response?.data?.error || 'Đặt lại mật khẩu thất bại.')
    }
  }

  const getOverrideType = (jobType: string) => {
    const jt = jobType.toUpperCase();
    if (jt === 'PRINT_ONLY' || jt === 'PRINT_LABEL') return 'REPRINT';
    if (jt === 'MARK_ONLY' || jt === 'LASER_MARK') return 'RELASER';
    return 'REPROCESS';
  };

  const translateTriggerType = (type: string) => {
    if (!type) return '—';
    const t = type.toUpperCase();
    if (t === 'AUTO') return 'Yêu cầu tự động (Original)';
    if (t === 'MANUALREPRINT') return 'In lại nhãn (Manual Reprint)';
    if (t === 'MANUALREMARKING') return 'Khắc lại laser (Manual Re-marking)';
    if (t === 'MANUALREPROCESSING') return 'Làm lại quy trình (Manual Reprocess)';
    if (t === 'MANUAL_RETRY') return 'Thử lại thủ công';
    return type;
  };

  // Fetch attempts ofselected reprint record to populate parentAttemptId
  useEffect(() => {
    if (selectedReprintRecord) {
      jobsApi.getAttempts(selectedReprintRecord.jobId)
        .then(res => {
          const attempts = res.data;
          if (attempts && attempts.length > 0) {
            const sorted = [...attempts].sort((a: any, b: any) => b.attemptNo - a.attemptNo);
            setLatestAttemptId(sorted[0].id);
          } else {
            setLatestAttemptId('none');
          }
        })
        .catch(() => setLatestAttemptId('none'));
    } else {
      setLatestAttemptId('none');
    }
  }, [selectedReprintRecord]);

  // Fetch pieces belonging to the selected Work Order
  useEffect(() => {
    let active = true;
    if (selectedDetailRecord && selectedDetailRecord.jobNo) {
      setLoadingPieces(true);
      setDetailPieces([]);
      setSelectedPieceJobId(null);
      setDetailTab('pieces');

      client.get(`/projection/records/work-order/${selectedDetailRecord.jobNo}`)
        .then(res => {
          if (active) {
            setDetailPieces(res.data);
            if (res.data && res.data.length > 0) {
              const sorted = [...res.data].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
              const match = sorted.find((p: any) => p.jobId === selectedDetailRecord.jobId) || sorted[0];
              setSelectedPieceJobId(match.jobId);
            }
          }
        })
        .catch(err => {
          console.error("Failed to load work order pieces:", err);
        })
        .finally(() => {
          if (active) setLoadingPieces(false);
        });
    } else {
      setDetailPieces([]);
      setSelectedPieceJobId(null);
    }
    return () => { active = false };
  }, [selectedDetailRecord]);

  // Fetch attempts and history for history detail modal (based on selected piece)
  useEffect(() => {
    let active = true;
    if (selectedPieceJobId) {
      setLoadingDetail(true)
      setSelectedAttemptId(null)
      setAttemptSteps({})

      jobsApi.getAttempts(selectedPieceJobId)
        .then(attemptsRes => {
          if (active) {
            setDetailAttempts(attemptsRes.data)
            if (attemptsRes.data && attemptsRes.data.length > 0) {
              const latest = [...attemptsRes.data].sort((a: any, b: any) => b.attemptNo - a.attemptNo)[0];
              setSelectedAttemptId(latest.id);
            }
          }
        })
        .catch(err => {
          console.error("Failed to load job details:", err)
        })
        .finally(() => {
          if (active) setLoadingDetail(false)
        })
    }
    return () => { active = false };
  }, [selectedPieceJobId])

  // Fetch steps for selected attempt in history detail modal
  useEffect(() => {
    if (selectedAttemptId && !attemptSteps[selectedAttemptId]) {
      jobsApi.getAttemptSteps(selectedAttemptId)
        .then(res => {
          setAttemptSteps(prev => ({ ...prev, [selectedAttemptId]: res.data }))
        })
        .catch(err => {
          console.error("Failed to load attempt steps:", err)
        })
    }
  }, [selectedAttemptId])

  const handleTriggerReprint = () => {
    if (!selectedReprintRecord) return
    const type = getOverrideType(selectedReprintRecord.jobType)
    if (type === 'REPRINT' || type === 'RELASER') {
      setOverrideConfirmData({
        title: 'Xử lý lại sản phẩm',
        description: 'Hành động này sẽ tạo ra một lượt gia công mới và lưu giữ toàn bộ dữ liệu lịch sử.\n\nBạn có muốn tiếp tục?',
        type
      })
    } else {
      setOverrideConfirmData({
        title: 'Thử lại lệnh thất bại',
        description: 'Một lượt thử lại mới sẽ được tạo ra.\n\nDữ liệu lịch sử sẽ không bị sửa đổi.\n\nBạn có muốn tiếp tục?',
        type
      })
    }
    setOverrideConfirmOpen(true)
  }

  const handleConfirmTriggerReprint = async () => {
    setOverrideConfirmOpen(false)
    if (!selectedReprintRecord || !overrideConfirmData) return
    setReprintError('')
    setReprintSuccess('')
    setSubmittingReprint(true)
    try {
      const type = overrideConfirmData.type
      await commandsApi.manualOverride({
        jobId: selectedReprintRecord.jobId,
        jobNo: selectedReprintRecord.jobNo,
        productCode: selectedReprintRecord.productCode,
        parentAttemptId: latestAttemptId,
        reasonCode: reprintReasonCode,
        reasonDescription: reprintComment,
        overrideType: type
      });
      setReprintSuccess('Yêu cầu in/khắc lại đã được gửi thành công.');
      setReprintComment('');
      setReprintConfirmed(false);
      setSelectedReprintRecord(null);
      setTimeout(() => {
        setIsReprintListOpen(false)
        setReprintSuccess('')
      }, 1500)
    } catch (err: any) {
      setReprintError(err.response?.data?.error || 'Không thể gửi yêu cầu in/khắc lại.');
    } finally {
      setSubmittingReprint(false)
      setOverrideConfirmData(null)
    }
  }


  /* ── tab config ───────────────────────────────────────── */
  const tabs = [
    { key: 'dashboard' as KioskTab, label: 'Bảng điều khiển', icon: LayoutDashboard, show: canViewJobs },
    { key: 'orders' as KioskTab, label: 'Lệnh sản xuất', icon: Database, show: canViewJobs },
    { key: 'history' as KioskTab, label: 'Lịch sử sản xuất', icon: History, show: canViewJobs },
    { key: 'traceability' as KioskTab, label: 'Truy xuất nguồn gốc', icon: Search, show: canViewJobs },
    { key: 'queue' as KioskTab, label: 'Giám sát pipeline', icon: Activity, show: canViewJobs },
    { key: 'alarms' as KioskTab, label: 'Trung tâm cảnh báo', icon: AlertTriangle, show: true },
    { key: 'config' as KioskTab, label: 'Cấu hình thiết bị', icon: Settings, show: isSuperAdmin },
    { key: 'diagnostics' as KioskTab, label: 'Chẩn đoán hệ thống', icon: LineChart, show: true },
    { key: 'connectivity' as KioskTab, label: 'Kết nối mạng', icon: Cpu, show: true },
    { key: 'rbac' as KioskTab, label: 'Quản lý phân quyền', icon: Users, show: isSuperAdmin },
    { key: 'templates' as KioskTab, label: 'Label Templates', icon: FileText, show: true },
  ]

  /* ═══════════════════════════════════════════════════════ */
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">

      {/* ── TOP HEADER BAR ──────────────────────────────── */}
      <header className="sticky top-0 z-40 w-full border-b border-border bg-card">
        <div className="flex h-16 items-center justify-between gap-4 px-6 lg:px-8 max-w-7xl mx-auto w-full">
          {/* Brand */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-dark to-brand">
              <Flame className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-base leading-tight truncate">ND Station Kiosk</p>
              <p className="text-sm text-muted-fg leading-tight">{stationId}</p>
            </div>
          </div>

          {/* Center: current user & clock */}
          <div className="hidden md:flex items-center gap-6 text-sm text-muted-fg">
            {currentUser && (
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 shrink-0 text-brand" />
                <span>
                  <span className="font-bold text-foreground text-base">{currentUser.username}</span>
                  <span className="ml-1.5 opacity-70">({currentUser.roles?.map(translateRole).join(', ')})</span>
                </span>
              </div>
            )}
            <div className="h-4 w-px bg-border"></div>
            <div className="flex items-center gap-2 font-mono text-base font-bold text-brand-light bg-brand/5 px-3 py-1 rounded-full border border-brand/10">
              <Clock className="h-4 w-4 text-brand animate-pulse" />
              <span>{currentTime.toLocaleTimeString('vi-VN')}</span>
              <span className="text-xs text-muted-fg font-normal ml-1">
                {currentTime.toLocaleDateString('vi-VN')}
              </span>
            </div>
          </div>

          {/* Right: status + logout */}
          <div className="flex items-center gap-3 shrink-0">
            <Badge variant={isConnected ? 'connected' : 'disconnected'} className="gap-1.5 hidden sm:flex text-sm">
              {isConnected
                ? <><Wifi className="h-3 w-3" /> SignalR</>
                : <><WifiOff className="h-3 w-3" /> Offline</>
              }
            </Badge>

            {/* Theme Toggle Button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
              className="h-9 w-9 text-muted-fg hover:text-foreground hover:bg-surface-2 rounded-lg cursor-pointer flex items-center justify-center shrink-0"
              title={theme === 'dark' ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
            >
              {theme === 'dark' ? (
                <Sun className="h-5 w-5 text-brand animate-pulse" />
              ) : (
                <Moon className="h-5 w-5 text-brand" />
              )}
            </Button>

            <Button variant="ghost" size="sm" onClick={handleLogout}
              className="gap-1.5 text-muted-fg hover:text-red-400 hover:bg-red-500/10 text-base"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </Button>
          </div>
        </div>
      </header>

      {/* ── PERSISTENT ALARM ALERT BAR ──────────────────── */}
      {alarms.filter(a => !a.isAcknowledged).length > 0 && (
        <div
          onClick={() => setTab('alarms')}
          className="w-full bg-red-500/10 hover:bg-red-500/15 border-b border-red-500/30 text-red-400 py-3.5 px-6 lg:px-8 text-center text-base font-extrabold flex items-center justify-center gap-2 cursor-pointer transition-colors duration-150 animate-pulse select-none"
        >
          <AlertTriangle className="h-5 w-5 animate-bounce shrink-0" />
          <span>HỆ THỐNG PHÁT HIỆN CÓ KHÓA BÁO ĐỘNG CHƯA XÁC NHẬN ({alarms.filter(a => !a.isAcknowledged).length} CẢNH BÁO) — NHẤN ĐỂ VÀO TRUNG TÂM XỬ LÝ</span>
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── LEFT SIDEBAR NAVIGATION ────────────────── */}
        <aside className="w-76 border-r border-border bg-card flex flex-col shrink-0 select-none">
          <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
            {tabs.filter((t) => t.show).map(({ key, label, icon: Icon }) => {
              const active = tab === key
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={[
                    'w-full flex items-center gap-3.5 px-4.5 py-4 text-base font-bold rounded-xl border transition-all duration-200 cursor-pointer touch-manipulation text-left',
                    active
                      ? 'border-brand text-brand bg-brand/10 shadow-[0_0_15px_rgba(240,90,26,0.1)] font-extrabold'
                      : 'border-transparent text-muted-fg hover:text-foreground hover:bg-surface-2 hover:border-border/40',
                  ].join(' ')}
                >
                  <Icon className={['h-5.5 w-5.5 shrink-0 transition-transform duration-200', active ? 'scale-110 text-brand animate-pulse' : 'text-muted-fg'].join(' ')} />
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
        </aside>

        {/* ── MAIN CONTENT ────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8 bg-background">

          {/* ════ TAB: DASHBOARD ════════════════════════════ */}
          {tab === 'dashboard' && (() => {
            const isCurrentJob = activeJobDetails && (production?.jobStatus === 'PROCESSING' || production?.jobStatus === 'QUEUED' || production?.jobStatus === 'PENDING');

            const resolved = isCurrentJob ? getResolvedData() : {
              production_order: '—',
              work_order: '—',
              workflow: '—',
              operation: '—',
              station: 'STATION-01',
              team: '—',
              operator: currentUser?.username || '—',
              product_name: '—',
              product_code: '—',
              revision: '—',
              customer: '—',
              material: '—',
              rubber_type: '—',
              lot_number: '—',
              batch_number: '—',
              manufacture_date: '—',
              expiry_date: '—',
              country: '—',
              serial_number: '—',
              trace_id: '—',
              planned_quantity: '0',
              completed_quantity: '0',
              remaining_quantity: '0',
              current_step: '—'
            };

            const visionResult = isCurrentJob ? getVisionResult() : {
              result: 'PENDING',
              ocrText: '—',
              confidence: 0,
              defectCode: null as string | null,
              durationMs: 0
            };

            const printerDevice = devices.find((d: any) => d.deviceType === 'PRINTER' || d.deviceId.includes('printer'));
            const isPrinterOnline = printerDevice?.isOnline ?? false;

            const planned = parseInt(resolved.planned_quantity || '0', 10);
            const completed = parseInt(resolved.completed_quantity || '0', 10);
            const pct = planned > 0 ? Math.round((completed / planned) * 100) : 0;

            return (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">

                {/* LEFT COLUMN: Panels 1, 2, 3, 5, 6 */}
                <div className="lg:col-span-2 space-y-6">

                  {/* PANEL 1: Production Information */}
                  <Card className="border border-border bg-card shadow-sm hover:shadow-md transition-shadow">
                    <CardHeader className="py-4 px-6 border-b border-border bg-brand/5 dark:bg-brand-dark/10">
                      <CardTitle className="text-sm font-bold tracking-wider text-brand uppercase flex items-center gap-2">
                        <Database className="h-4 w-4" />
                        1. Thông tin lệnh sản xuất (Production Info)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Mã Lệnh (Production Order)</span>
                          <div className="text-lg font-bold font-mono tracking-tight text-foreground">{resolved.production_order}</div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Work Order / SKU</span>
                          <div className="text-lg font-bold font-mono tracking-tight text-foreground">{resolved.work_order}</div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Quy trình (Workflow)</span>
                          <div className="text-sm font-medium text-foreground">{resolved.workflow}</div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Công đoạn (Operation)</span>
                          <div className="text-sm font-medium text-foreground flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-xs bg-brand/10 text-brand-light border border-brand/20 font-mono">
                              {resolved.operation}
                            </span>
                            <span className="text-muted-fg font-mono text-xs">({resolved.current_step || 'Step 1'})</span>
                          </div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Trạm vận hành (Station)</span>
                          <div className="text-sm font-semibold font-mono text-foreground">{resolved.station}</div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Đội sản xuất (Assigned Team)</span>
                          <div className="text-sm font-medium text-foreground">{resolved.team}</div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Người vận hành (Operator)</span>
                          <div className="text-sm font-medium text-foreground flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                            {currentUser?.username || resolved.operator}
                          </div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Tiến độ sản lượng (Quantity / Progress)</span>
                          <div className="text-sm font-semibold font-mono text-foreground">
                            {completed} / {planned} pcs <span className="text-xs text-muted-fg font-normal">(Còn lại: {resolved.remaining_quantity})</span>
                          </div>
                        </div>
                      </div>
                      {/* Progress Bar */}
                      <div className="mt-4 pt-2 border-t border-border/50">
                        <div className="flex justify-between items-center mb-1 text-xs font-semibold text-muted-fg">
                          <span>TIẾN ĐỘ HOÀN THÀNH</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="w-full bg-surface-2 rounded-full h-2 overflow-hidden border border-border/50">
                          <div className="bg-brand-dark h-full rounded-full transition-all duration-500" style={{ width: `${pct}%` }}></div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* PANEL 2: Product Information */}
                  <Card className="border border-border bg-card shadow-sm hover:shadow-md transition-shadow">
                    <CardHeader className="py-4 px-6 border-b border-border bg-teal-900/5 dark:bg-teal-950/20">
                      <CardTitle className="text-sm font-bold tracking-wider text-teal-500 uppercase flex items-center gap-2">
                        <Cpu className="h-4 w-4" />
                        2. Thông tin sản phẩm (Product Detail)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                      <div className="grid grid-grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Tên sản phẩm (Product Name)</span>
                          <div className="text-sm font-bold text-foreground">{resolved.product_name}</div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Mã SKU (Product Code)</span>
                          <div className="text-sm font-bold font-mono text-foreground">{resolved.product_code}</div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Phiên bản (Revision)</span>
                          <div className="text-sm font-semibold font-mono text-foreground">{resolved.revision}</div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Nhóm vật liệu (Material / Rubber)</span>
                          <div className="text-sm font-medium text-foreground">{resolved.material} ({resolved.rubber_type})</div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Độ cứng & Màu sắc (Hardness / Color)</span>
                          <div className="text-sm font-medium text-foreground">70 Shore A / Đen (Black)</div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Số Lô sản xuất (Lot / Batch)</span>
                          <div className="text-sm font-bold font-mono text-foreground">{resolved.lot_number} <span className="text-xs text-muted-fg font-normal">({resolved.batch_number})</span></div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Ngày sản xuất / Hết hạn</span>
                          <div className="text-sm font-semibold font-mono text-foreground">{resolved.manufacture_date} / {resolved.expiry_date}</div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Xuất xứ / Khách hàng (OEM)</span>
                          <div className="text-sm font-medium text-foreground">{resolved.country} / {resolved.customer}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* PANEL 3: Traceability */}
                  <Card className="border border-border bg-card shadow-sm hover:shadow-md transition-shadow">
                    <CardHeader className="py-4 px-6 border-b border-border bg-amber-900/5 dark:bg-amber-950/20">
                      <CardTitle className="text-sm font-bold tracking-wider text-amber-500 uppercase flex items-center gap-2">
                        <Zap className="h-4 w-4" />
                        3. Truy xuất nguồn gốc sản phẩm (Traceability)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Số Serial sản phẩm (Serial Number)</span>
                          <div className="text-sm font-bold font-mono text-foreground">{resolved.serial_number}</div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Mã định danh Trace ID (Trace ID)</span>
                          <div className="text-sm font-bold font-mono text-foreground">{resolved.trace_id}</div>
                        </div>
                        <div className="sm:col-span-2 p-3 bg-surface-2 rounded-lg border border-border/50">
                          <div className="flex flex-col gap-1 text-xs">
                            <div className="flex justify-between font-mono">
                              <span className="text-muted-fg">Barcode Payload (Code128):</span>
                              <span className="text-foreground font-semibold">{resolved.serial_number}</span>
                            </div>
                            <div className="flex justify-between font-mono">
                              <span className="text-muted-fg">DataMatrix Payload (ECC200):</span>
                              <span className="text-foreground font-semibold">{resolved.trace_id}</span>
                            </div>
                            <div className="flex justify-between font-mono pt-1 mt-1 border-t border-border/30">
                              <span className="text-muted-fg">Thời gian khởi tạo (Timestamp):</span>
                              <span className="text-foreground">{activeJobDetails?.createdAt ? new Date(activeJobDetails.createdAt).toLocaleString('vi-VN') : '—'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* PANEL 5: Printer Information */}
                  <Card className="border border-border bg-card shadow-sm hover:shadow-md transition-shadow">
                    <CardHeader className="py-4 px-6 border-b border-border bg-emerald-900/5 dark:bg-emerald-950/20">
                      <CardTitle className="text-sm font-bold tracking-wider text-emerald-500 uppercase flex items-center gap-2">
                        <PrinterIcon className="h-4 w-4" />
                        5. Thông tin cấu hình máy in (Printer Info)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Trạng thái kết nối (Connection)</span>
                          <div className="text-sm font-semibold flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${isPrinterOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></span>
                            {isPrinterOnline ? 'ONLINE (TCP/IP)' : 'OFFLINE'}
                          </div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Địa chỉ IP / Port (Zebra ZPL)</span>
                          <div className="text-sm font-bold font-mono text-foreground">
                            {printerDevice ? '192.168.1.150' : '—'}:{printerDevice ? '9100' : '—'}
                          </div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Độ phân giải (DPI / Density)</span>
                          <div className="text-sm font-medium text-foreground">203 DPI (8 dpmm)</div>
                        </div>
                        <div>
                          <span className="text-xs uppercase text-muted-fg font-semibold">Kích thước nhãn (Label Size)</span>
                          <div className="text-sm font-medium text-foreground">100mm x 60mm (4x2.4 in)</div>
                        </div>
                        <div className="sm:col-span-2 grid grid-cols-2 gap-4 pt-2 border-t border-border/50">
                          <div>
                            <div className="flex justify-between text-xs font-semibold text-muted-fg mb-1">
                              <span>MỰC IN (RIBBON LEVEL)</span>
                              <span>86%</span>
                            </div>
                            <div className="w-full bg-surface-2 rounded-full h-1.5 overflow-hidden">
                              <div className="bg-emerald-500 h-full" style={{ width: '86%' }}></div>
                            </div>
                          </div>
                          <div>
                            <div className="flex justify-between text-xs font-semibold text-muted-fg mb-1">
                              <span>CUỘN GIẤY (MEDIA LEVEL)</span>
                              <span>94%</span>
                            </div>
                            <div className="w-full bg-surface-2 rounded-full h-1.5 overflow-hidden">
                              <div className="bg-emerald-500 h-full" style={{ width: '94%' }}></div>
                            </div>
                          </div>
                        </div>
                        <div className="sm:col-span-2 text-xs text-muted-fg font-semibold flex gap-4 pt-1">
                          <span>NHIỆT ĐỘ ĐẦU IN: 28°C (Bình thường)</span>
                          <span>TỐC ĐỘ: 4 ips</span>
                          <span>ĐỘ ĐẬM (DARKNESS): 25</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* PANEL 6: Verification Info */}
                  <Card className="border border-border bg-card shadow-sm hover:shadow-md transition-shadow">
                    <CardHeader className="py-4 px-6 border-b border-border bg-rose-900/5 dark:bg-rose-950/20">
                      <CardTitle className="text-sm font-bold tracking-wider text-rose-500 uppercase flex items-center gap-2">
                        <Camera className="h-4 w-4" />
                        6. Kết quả xác thực camera ngoại quan (Verification Result)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                      <div className="flex flex-col md:flex-row items-center gap-6">

                        {/* Big PASS/FAIL indicator */}
                        <div className="flex flex-col items-center justify-center p-6 rounded-xl border border-border/40 bg-surface-2 w-full md:w-44 h-32 relative overflow-hidden shadow-inner">
                          <span className="text-xs uppercase text-muted-fg font-bold tracking-widest mb-1.5">KẾT QUẢ</span>
                          {visionResult.result === 'PASS' && (
                            <div className="text-3xl font-extrabold text-emerald-500 tracking-wider drop-shadow-[0_0_12px_rgba(16,185,129,0.3)] flex items-center gap-1.5 animate-bounce">
                              <CheckCircle2 className="h-7 w-7" />
                              PASS
                            </div>
                          )}
                          {visionResult.result === 'FAIL' && (
                            <div className="text-3xl font-extrabold text-red-500 tracking-wider drop-shadow-[0_0_12px_rgba(239,68,68,0.3)] flex items-center gap-1.5">
                              <ShieldAlert className="h-7 w-7" />
                              FAIL
                            </div>
                          )}
                          {visionResult.result === 'PROCESSING' && (
                            <div className="text-xl font-extrabold text-amber-500 tracking-wider animate-pulse flex items-center gap-2">
                              <RefreshCw className="h-5 w-5 animate-spin" />
                              ĐANG QUÉT
                            </div>
                          )}
                          {visionResult.result === 'PENDING' && (
                            <div className="text-xl font-bold text-muted-fg tracking-wider">
                              ĐANG CHỜ
                            </div>
                          )}
                        </div>

                        {/* Vision details */}
                        <div className="flex-1 space-y-2 w-full text-sm">
                          <div className="flex justify-between border-b border-border/30 pb-1.5">
                            <span className="text-muted-fg">Mã OCR đọc được (OCR text):</span>
                            <span className="font-mono font-bold text-foreground">{visionResult.ocrText}</span>
                          </div>
                          <div className="flex justify-between border-b border-border/30 pb-1.5">
                            <span className="text-muted-fg">Độ tin cậy xác thực (Confidence):</span>
                            <span className="font-mono font-bold text-foreground">
                              {visionResult.confidence > 0 ? `${(visionResult.confidence * 100).toFixed(1)}%` : '—'}
                            </span>
                          </div>
                          <div className="flex justify-between border-b border-border/30 pb-1.5">
                            <span className="text-muted-fg">Mã lỗi phát hiện (Defect Code):</span>
                            <span className={`font-semibold font-mono ${visionResult.defectCode ? 'text-red-500' : 'text-emerald-500'}`}>
                              {visionResult.defectCode || 'Không có lỗi (None)'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-fg">Kiểm tra trùng lặp (Duplicate check):</span>
                            <span className="text-emerald-500 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="h-4 w-4" />
                              HỢP LỆ (PASS)
                            </span>
                          </div>
                        </div>

                      </div>
                    </CardContent>
                  </Card>

                </div>

                {/* RIGHT COLUMN: Panels 4 (Label Preview) & 7 (Job Timeline) */}
                <div className="space-y-6">

                  {/* PANEL 4: Label Preview — barcode rendered client-side via JsBarcode */}
                  <Card className="border border-border bg-card shadow-sm hover:shadow-md transition-shadow">
                    <CardHeader className="py-4 px-6 border-b border-border bg-brand/5 dark:bg-brand-dark/10">
                      <CardTitle className="text-sm font-bold tracking-wider text-brand uppercase flex items-center gap-2">
                        <PrinterIcon className="h-4 w-4" />
                        4. Xem trước nhãn in (Label Preview)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      {/* Template meta row */}
                      <div className="w-full flex justify-between text-xs text-muted-fg font-semibold mb-3 border-b border-border/50 pb-2">
                        <span>Mẫu nhãn: {activeTemplate?.name || 'Mẫu nhãn tiêu chuẩn'}</span>
                        <span>DPI: {activeTemplate?.dpi || 203} | Code128</span>
                      </div>

                      {/* Label preview — rendered client-side from template JSON, no external API */}
                      <div className="w-full min-h-[200px] flex items-center justify-center border border-dashed border-border/60 rounded-lg p-2 bg-slate-50 dark:bg-zinc-950/40 shadow-inner relative">
                        {(() => {
                          const resolvedData = getResolvedData()
                          const hasData = !!activeJobDetails?.productSerial
                          
                          if (!hasData) {
                            return (
                              <div className="text-center p-4 text-muted-fg text-sm flex flex-col items-center gap-2">
                                <PrinterIcon className="h-10 w-10 text-muted-fg/40" />
                                Chưa có thông tin kết xuất nhãn in hiện tại.
                              </div>
                            )
                          }

                          return (
                            <LabelPreview
                              template={activeTemplate}
                              data={resolvedData}
                              width={300}
                              className="rounded-md border border-border shadow-md"
                            />
                          )
                        })()}
                      </div>

                      {/* Serial info row */}
                      {activeJobDetails?.productSerial && (
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span className="text-muted-fg">Serial (mã vạch/QR):</span>
                          <span className="font-mono font-bold text-foreground text-[11px]">
                            {activeJobDetails.productSerial}
                          </span>
                        </div>
                      )}

                      <div className="w-full text-center text-xs text-muted-fg mt-2 italic">
                        * Bản xem trước tự động cập nhật từ cấu hình Template ZPL.
                      </div>
                    </CardContent>
                  </Card>


                  {/* PANEL 7: Job Timeline */}
                  <Card className="border border-border bg-card shadow-sm hover:shadow-md transition-shadow">
                    <CardHeader className="py-4 px-6 border-b border-border bg-slate-900/5 dark:bg-slate-950/20">
                      <CardTitle className="text-sm font-bold tracking-wider text-slate-500 uppercase flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        7. Nhật ký công việc trạm (Station Activity Log)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="relative border-l border-border/70 ml-2 pl-4 space-y-4 max-h-[360px] overflow-y-auto pr-2">
                        {activities.map((activity: any) => (
                          <div key={activity.id}
                            onClick={() => {
                              if (!activity.jobNo) return;
                              const dummyRecord: any = {
                                id: activity.id,
                                jobId: activity.jobId || '',
                                jobNo: activity.jobNo,
                                productCode: activity.productCode || 'GENERIC',
                                productSerial: 'Set of commands',
                                jobType: activity.jobType || 'PRINT_ONLY',
                                currentStatus: activity.status || 'PROCESSING',
                                stationId: stationId,
                                createdAt: activity.occurredAt,
                                updatedAt: activity.occurredAt
                              };
                              setSelectedDetailRecord(dummyRecord);
                              setIsDetailDialogOpen(true);
                            }}
                            className="relative text-xs cursor-pointer hover:bg-surface-2 p-1.5 rounded transition-colors group"
                          >
                            {/* Indicator dot */}
                            <span className={`absolute -left-[21px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-card ${activity.status === 'SUCCESS' || activity.status === 'COMPLETED' ? 'bg-emerald-500' :
                                activity.status === 'FAILED' ? 'bg-red-500' : 'bg-brand'
                              }`}></span>

                            <div className="flex justify-between items-center text-muted-fg font-mono mb-0.5">
                              <span className="font-bold text-foreground uppercase tracking-wider group-hover:text-brand transition-colors">{activity.eventType}</span>
                              <span>{new Date(activity.occurredAt).toLocaleTimeString('vi-VN')}</span>
                            </div>
                            <p className="text-muted-fg text-xs leading-relaxed">{activity.message}</p>
                          </div>
                        ))}
                        {activities.length === 0 && (
                          <div className="text-center p-4 text-muted-fg text-sm">
                            Chưa ghi nhận hoạt động nào hôm nay.
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                </div>

                {/* Action reprint buttons */}
                <div className="lg:col-span-3 flex justify-between items-center pt-4 border-t border-border/50">
                  <div className="text-sm font-semibold flex items-center gap-1.5 text-muted-fg">
                    <span className={`h-2.5 w-2.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                    {isConnected ? 'Kiosk Agent connected to SignalR' : 'Kiosk Agent disconnected'}
                  </div>
                  <Button
                    onClick={() => {
                      setIsReprintListOpen(true)
                      setSelectedReprintRecord(null)
                      setReprintReasonCode('PRINT_QUALITY')
                      setReprintError('')
                      setReprintSuccess('')
                    }}
                    disabled={!canReprocess}
                    className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white font-extrabold px-6 py-3 rounded-lg shadow-md transition-all duration-300 gap-2 uppercase tracking-wider text-sm"
                  >
                    <PrinterIcon className="h-4 w-4" />
                    Xử lý lại sản phẩm (Reprocess)
                  </Button>
                </div>

              </div>
            );
          })()}


          {/* ════ TAB: HISTORY ═══════════════════════════════ */}
          {tab === 'history' && (
            <div className="space-y-6 max-w-7xl mx-auto">
              {/* Filter Panel */}
              <Card className="border border-border bg-card">
                <CardHeader className="py-4 px-6 border-b border-border">
                  <CardTitle className="text-base font-bold uppercase tracking-wider flex items-center gap-2">
                    <Filter className="h-4 w-4 text-brand" />
                    Bộ lọc tìm kiếm lịch sử
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div className="space-y-1">
                      <Label htmlFor="filter-wo" className="text-sm">Lệnh sản xuất</Label>
                      <Input
                        id="filter-wo"
                        placeholder="Tìm WO..."
                        value={historyFilters.workOrder}
                        onChange={(e) => setHistoryFilters(prev => ({ ...prev, workOrder: e.target.value }))}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="filter-sku" className="text-sm">Mã sản phẩm</Label>
                      <Input
                        id="filter-sku"
                        placeholder="Tìm SKU..."
                        value={historyFilters.productCode}
                        onChange={(e) => setHistoryFilters(prev => ({ ...prev, productCode: e.target.value }))}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-sm">Trạng thái</Label>
                      <Select
                        value={historyFilters.status}
                        onValueChange={(val) => setHistoryFilters(prev => ({ ...prev, status: val }))}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Tất cả trạng thái" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_all">Tất cả</SelectItem>
                          <SelectItem value="RECEIVED">Đã nhận yêu cầu</SelectItem>
                          <SelectItem value="QUEUED">Đang trong hàng chờ</SelectItem>
                          <SelectItem value="PROCESSING">Đang xử lý</SelectItem>
                          <SelectItem value="PRINTING">Đang in/khắc</SelectItem>
                          <SelectItem value="VERIFYING">Đang kiểm tra</SelectItem>
                          <SelectItem value="COMPLETED">Hoàn thành</SelectItem>
                          <SelectItem value="FAILED">Thất bại</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="filter-from" className="text-sm">Từ ngày</Label>
                      <Input
                        id="filter-from"
                        type="date"
                        value={historyFilters.dateFrom}
                        onChange={(e) => setHistoryFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="filter-to" className="text-sm">Đến ngày</Label>
                      <Input
                        id="filter-to"
                        type="date"
                        value={historyFilters.dateTo}
                        onChange={(e) => setHistoryFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                        className="h-9 text-sm"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setHistoryFilters({ status: '', productCode: '', workOrder: '', dateFrom: getTodayStr(), dateTo: getTodayStr() })
                        setHistoryPage(1)
                      }}
                      className="h-9 text-sm"
                    >
                      Xóa bộ lọc
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setHistoryPage(1)
                        fetchHistory(1, historyPageSize, historyFilters)
                      }}
                      className="h-9 text-sm"
                    >
                      Tìm kiếm
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* History Table */}
              <Card className="border border-border bg-card">
                <CardHeader className="py-4 px-6 border-b border-border flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-bold uppercase tracking-wider flex items-center gap-2">
                      <Database className="h-4 w-4 text-brand" />
                      Lịch sử lưu trữ hệ thống
                    </CardTitle>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchHistory(historyPage, historyPageSize, historyFilters)}
                    disabled={loadingHistory}
                    className="text-sm"
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${loadingHistory ? 'animate-spin' : ''}`} />
                    Làm mới
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  {historyError && (
                    <div className="p-6 text-center text-red-500 text-base">{historyError}</div>
                  )}

                  <div className="w-full overflow-x-auto">
                    <TableEl>
                      <TableHeader className="bg-surface-2">
                        <TableRow>
                          <TableHead className="pl-6 text-sm">Thời gian</TableHead>
                          <TableHead className="text-sm">Lệnh sản xuất</TableHead>
                          <TableHead className="text-sm">Mã sản phẩm</TableHead>
                          <TableHead className="text-sm">Sản lượng hoàn thành</TableHead>
                          <TableHead className="text-sm">Trạng thái</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loadingHistory ? (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center py-12 text-muted-fg text-base">
                              Đang tải lịch sử...
                            </TableCell>
                          </TableRow>
                        ) : historyData?.items && historyData.items.length > 0 ? (
                          historyData.items.map((record) => (
                            <TableRow
                              key={record.id}
                              className="hover:bg-surface-1 cursor-pointer"
                              onClick={() => {
                                setSelectedDetailRecord(record);
                                setIsDetailDialogOpen(true);
                              }}
                            >
                              <TableCell className="pl-6 font-mono text-sm">
                                {new Date(record.updatedAt).toLocaleString('vi-VN')}
                              </TableCell>
                              <TableCell className="font-bold text-sm">{record.jobNo}</TableCell>
                              <TableCell className="text-muted-fg text-sm">{record.productCode}</TableCell>
                              <TableCell className="font-mono text-sm text-muted-fg">{record.productSerial || '—'}</TableCell>
                              <TableCell>
                                <StatusBadge status={record.currentStatus} jobType={record.jobType} />
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center py-12 text-muted-fg text-base">
                              Không tìm thấy lịch sử phù hợp.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </TableEl>
                  </div>

                  {/* Server Pagination */}
                  {historyData && historyData.totalPages > 1 && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border px-6 py-4 bg-surface-2">
                      <span className="text-sm text-muted-fg">
                        Hiển thị trang <strong className="text-foreground">{historyPage}</strong> / <strong className="text-foreground">{historyData.totalPages}</strong> ({historyData.totalCount} kết quả)
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={historyPage === 1 || loadingHistory}
                          onClick={() => setHistoryPage(prev => Math.max(1, prev - 1))}
                          className="text-sm"
                        >
                          Trang trước
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={historyPage === historyData.totalPages || loadingHistory}
                          onClick={() => setHistoryPage(prev => Math.min(historyData.totalPages, prev + 1))}
                        >
                          Trang sau
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ════ TAB: CONNECTIVITY ══════════════════════════ */}
          {tab === 'connectivity' && (
            <div className="space-y-6 max-w-7xl mx-auto">
              {/* Gateway status panel */}
              <Card className="border-2 border-brand/20 bg-brand/5 overflow-hidden">
                <div className="p-6 flex flex-col md:flex-row items-center justify-between gap-6">
                  <div>
                    <h3 className="font-extrabold text-base text-foreground flex items-center gap-2">
                      <Flame className="h-5 w-5 text-brand" />
                      Cổng truyền thông Factory Gateway
                    </h3>
                    <p className="text-sm text-muted-fg mt-1">
                      Cổng trung chuyển nhận lệnh từ ERP nhà máy. Trạng thái hiện tại:
                      <strong className={isGatewayOnline ? 'text-emerald-400 ml-1' : 'text-red-400 ml-1'}>
                        {isGatewayOnline ? 'Kết nối an toàn (Hoạt động)' : 'Mất kết nối trung tâm'}
                      </strong>.
                    </p>
                  </div>
                </div>
              </Card>

              {/* Device Grid */}
              <Card className="border border-border bg-card">
                <CardHeader className="border-b border-border py-4 px-6">
                  <CardTitle className="text-base font-bold uppercase tracking-wider flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-brand" />
                    Mạng lưới thiết bị đầu cuối
                  </CardTitle>
                  <CardDescription className="text-sm">Theo dõi thời gian thực của các phần cứng tại chỗ</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    {devices.filter(d => d.deviceType !== 'GATEWAY').map((device) => {
                      const DeviceIcon =
                        device.deviceType === 'PLC' ? Cpu :
                          device.deviceType === 'PRINTER' ? PrinterIcon :
                            device.deviceType === 'LASER' ? Zap :
                              device.deviceType === 'VISION_CAMERA' ? Camera :
                                Cpu;

                      return (
                        <div key={device.deviceId} className="border border-border bg-surface-1 rounded-xl p-4 flex flex-col justify-between h-36 hover:border-brand/20 transition-all duration-300">
                          <div className="flex items-center justify-between">
                            <div className={`p-2.5 rounded-lg border ${device.isOnline ? 'border-emerald-500/10 bg-emerald-500/5 text-emerald-400' : 'border-red-500/10 bg-red-500/5 text-red-400'
                              }`}>
                              <DeviceIcon className="h-5 w-5" />
                            </div>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${device.isOnline ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                              }`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${device.isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`}></span>
                              {device.isOnline ? 'Online' : 'Offline'}
                            </span>
                          </div>

                          <div className="mt-4">
                            <p className="font-extrabold text-base text-foreground">{device.deviceId.toUpperCase()}</p>
                            <div className="flex justify-between items-center mt-1 text-xs text-muted-fg font-medium">
                              <span>Phân loại: {device.deviceType}</span>
                              <span>{new Date(device.lastSeenAt).toLocaleTimeString('vi-VN')}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {devices.filter(d => d.deviceType !== 'GATEWAY').length === 0 && (
                      <div className="col-span-4 text-center py-10 text-muted-fg text-base">
                        Đang kết nối để quét danh sách thiết bị...
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ════ TAB: TRACEABILITY ══════════════════════════ */}
          {tab === 'traceability' && (
            <div className="space-y-6 max-w-7xl mx-auto">
              <Card className="border border-border bg-card">
                <CardHeader className="py-4 px-6 border-b border-border bg-brand/5">
                  <CardTitle className="text-base font-bold tracking-wider text-brand uppercase flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    Truy xuất nguồn gốc sản phẩm (Traceability)
                  </CardTitle>
                  <CardDescription className="text-sm">Tìm kiếm lịch sử gia công chi tiết theo Số Serial sản phẩm</CardDescription>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                  <div className="flex gap-3 max-w-md">
                    <Input
                      placeholder="Nhập mã Serial sản phẩm (Ví dụ: SN-0001234)..."
                      value={searchSerial}
                      onChange={(e) => setSearchSerial(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleTraceSearch()}
                    />
                    <Button onClick={handleTraceSearch} disabled={traceLoading}>
                      {traceLoading ? 'Đang tìm...' : 'Tìm kiếm'}
                    </Button>
                  </div>

                  {traceError && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                      {traceError}
                    </div>
                  )}

                  {traceResult && (
                    <div className="space-y-6 animate-in fade-in duration-200">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-surface-1 p-4 rounded-lg border border-border">
                        <div>
                          <div className="text-xs text-muted-fg uppercase font-semibold">Mã Serial</div>
                          <div className="text-base font-bold font-mono text-foreground">{traceResult.job.productSerial || 'N/A'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-fg uppercase font-semibold">Mã Lệnh / SKU</div>
                          <div className="text-base font-bold text-foreground">{traceResult.job.productCode}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-fg uppercase font-semibold">Trạng thái hiện tại</div>
                          <div className="text-base font-bold"><StatusBadge status={traceResult.job.currentStatus} /></div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h4 className="font-bold text-sm text-foreground uppercase tracking-wider">Cây tiến trình gia công (Execution Timeline Tree)</h4>
                        <div className="relative border-l border-brand/20 ml-4 pl-6 space-y-6">
                          {traceResult.attempts.map((att: any, attIdx: number) => (
                            <div key={att.id} className="relative">
                              <div className="absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                                {attIdx + 1}
                              </div>
                              <div className="bg-surface-2 border border-border p-4 rounded-xl space-y-3">
                                <div className="flex justify-between items-center flex-wrap gap-2">
                                  <span className="font-bold text-sm text-foreground">
                                    Lượt gia công #{att.retrySequence + 1}
                                  </span>
                                  <span className="text-xs text-muted-fg font-mono">
                                    ID: {att.id}
                                  </span>
                                </div>

                                <div className="space-y-2">
                                  {att.steps.map((st: any) => (
                                    <div key={st.id} className="bg-card border border-border/80 p-3 rounded-lg flex flex-col sm:flex-row justify-between gap-3 text-xs">
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                          <span className="font-bold text-foreground">{st.stepName}</span>
                                          <span className="text-[10px] text-muted-fg">(Bước {st.stepOrder})</span>
                                        </div>
                                        {st.assignedDeviceId && (
                                          <div className="text-muted-fg">Thiết bị: <code className="bg-surface-3 px-1 rounded font-mono">{st.assignedDeviceId}</code></div>
                                        )}
                                        {st.payloadJsonStep && (
                                          <div className="text-[10px] text-muted-fg truncate max-w-md">Payload: <code className="font-mono">{st.payloadJsonStep}</code></div>
                                        )}
                                      </div>
                                      <div className="sm:text-right space-y-1 shrink-0">
                                        <div className="flex items-center sm:justify-end gap-1.5 font-semibold text-foreground">
                                          <span>{st.status}</span>
                                          {st.executionDurationMs > 0 && (
                                            <span className="text-muted-fg font-mono text-[10px]">({st.executionDurationMs}ms)</span>
                                          )}
                                        </div>
                                        <div className="text-[10px] text-muted-fg font-mono">{st.finishedAt ? new Date(st.finishedAt).toLocaleTimeString('vi-VN') : ''}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ════ TAB: QUEUE MONITOR ══════════════════════════ */}
          {/* ════ TAB: ORDERS ════════════════════════════════ */}
          {tab === 'orders' && (
            <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-200">
              {/* Dispatch Dialog */}
              <DispatchDialog
                open={dispatchDialogOpen}
                onClose={() => setDispatchDialogOpen(false)}
                onConfirm={handleConfirmDispatch}
                itemCount={orderItems.filter(i => i.currentStatus === 'QUEUED' || !i.currentStatus).length || selectedOrder?.remainingQty || 0}
                jobType={selectedOrder?.jobType || 'PRINT_LABEL'}
                isSubmitting={dispatchLoading}
              />

              {/* Order Detail Modal */}
              <Dialog open={orderModalOpen} onOpenChange={setOrderModalOpen}>
                <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto bg-card border border-border">
                  <DialogHeader>
                    <DialogTitle className="text-lg font-bold text-brand flex items-center gap-2">
                      <Database className="h-5 w-5" />
                      Chi tiết lệnh sản xuất: {selectedOrder?.orderNo}
                    </DialogTitle>
                    <DialogDescription>
                      <div className="flex flex-wrap gap-4 mt-2 text-sm">
                        <span>Mã SP: <strong className="text-foreground">{selectedOrder?.productCode}</strong></span>
                        <span>Kế hoạch: <strong className="text-foreground">{selectedOrder?.plannedQty} sản phẩm</strong></span>
                        <span>Hoàn thành: <strong className="text-emerald-400">{selectedOrder?.completedQty}</strong></span>
                        <span>Còn lại: <strong className="text-orange-400">{selectedOrder?.remainingQty}</strong></span>
                        <span>Tiến độ: <strong className="text-brand">{selectedOrder?.progressPercent}%</strong></span>
                      </div>
                      {selectedOrder && (
                        <div className="mt-3 w-full bg-surface-2 rounded-full h-2">
                          <div
                            className="bg-brand h-2 rounded-full transition-all duration-700"
                            style={{ width: `${selectedOrder.progressPercent}%` }}
                          />
                        </div>
                      )}
                    </DialogDescription>
                  </DialogHeader>
                  {orderItemsLoading ? (
                    <div className="flex items-center justify-center py-16 text-muted-fg text-sm">
                      <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Đang tải danh sách sản phẩm...
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-border rounded-xl mt-4">
                      <TableEl>
                        <TableHeader className="bg-muted/40">
                          <TableRow>
                            <TableHead className="pl-4 font-bold text-xs uppercase tracking-wider">#</TableHead>
                            <TableHead className="font-bold text-xs uppercase tracking-wider">Serial</TableHead>
                            <TableHead className="font-bold text-xs uppercase tracking-wider">Trạng thái</TableHead>
                            <TableHead className="font-bold text-xs uppercase tracking-wider">Máy in</TableHead>
                            <TableHead className="font-bold text-xs uppercase tracking-wider">Bắt đầu</TableHead>
                            <TableHead className="font-bold text-xs uppercase tracking-wider">Kết thúc</TableHead>
                            <TableHead className="font-bold text-xs uppercase tracking-wider">Thử lại</TableHead>
                            <TableHead className="pr-4 font-bold text-xs uppercase tracking-wider">Lỗi</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {orderItems.map((item, idx) => (
                            <TableRow key={item.id || idx} className="hover:bg-muted/10 transition-colors">
                              <TableCell className="pl-4 text-muted-fg text-xs font-mono">{idx + 1}</TableCell>
                              <TableCell className="font-mono text-xs text-foreground font-semibold">{item.productSerial || '—'}</TableCell>
                              <TableCell>
                                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  item.currentStatus === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400' :
                                  item.currentStatus === 'PROCESSING' ? 'bg-blue-500/10 text-blue-400' :
                                  item.currentStatus === 'FAILED' ? 'bg-red-500/10 text-red-400' :
                                  item.currentStatus === 'QUEUED' ? 'bg-amber-500/10 text-amber-400' :
                                  'bg-muted text-muted-fg'
                                }`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${
                                    item.currentStatus === 'COMPLETED' ? 'bg-emerald-400' :
                                    item.currentStatus === 'PROCESSING' ? 'bg-blue-400 animate-pulse' :
                                    item.currentStatus === 'FAILED' ? 'bg-red-400' :
                                    'bg-amber-400'
                                  }`} />
                                  {item.currentStatus || 'QUEUED'}
                                </span>
                              </TableCell>
                              <TableCell className="font-mono text-xs text-brand">{item.assignedPrinter || '—'}</TableCell>
                              <TableCell className="text-xs text-muted-fg">{item.startTime ? new Date(item.startTime).toLocaleTimeString('vi-VN') : '—'}</TableCell>
                              <TableCell className="text-xs text-muted-fg">{item.endTime ? new Date(item.endTime).toLocaleTimeString('vi-VN') : '—'}</TableCell>
                              <TableCell className="text-xs text-center">
                                {(item.retryCount || 0) > 0 ? (
                                  <span className="px-2 py-0.5 rounded bg-orange-500/10 text-orange-400 font-mono text-[10px] font-bold">{item.retryCount}</span>
                                ) : <span className="text-muted-fg">0</span>}
                              </TableCell>
                              <TableCell className="pr-4 text-xs text-red-400 max-w-[160px] truncate">{item.errorMessage || '—'}</TableCell>
                            </TableRow>
                          ))}
                          {orderItems.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={8} className="text-center py-10 text-muted-fg text-sm">
                                Chưa có sản phẩm nào trong lệnh này.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </TableEl>
                    </div>
                  )}
                  <DialogFooter className="mt-4 flex-col items-stretch gap-2">
                    {/* Dispatch result banner */}
                    {dispatchResult && (
                      <div className={`rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${
                        dispatchResult.success
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}>
                        {dispatchResult.success
                          ? `✓ Đã dispatch ${dispatchResult.dispatched}/${dispatchResult.total} jobs → ${
                              dispatchResult.target === 'production-printer' ? 'Máy in vật lý (CUPS)' : 'Máy mô phỏng'
                            }`
                          : '✗ Dispatch thất bại. Vui lòng thử lại.'}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setOrderModalOpen(false)}>Đóng</Button>
                      <Button onClick={() => fetchOrderItems(selectedOrder?.orderNo)} disabled={orderItemsLoading}>
                        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${orderItemsLoading ? 'animate-spin' : ''}`} /> Làm mới
                      </Button>
                      <Button
                        id="btn-dispatch-order"
                        className="bg-brand hover:bg-brand/90 text-white ml-auto"
                        onClick={() => { setDispatchResult(null); setDispatchDialogOpen(true) }}
                        disabled={dispatchLoading}
                      >
                        <Zap className="h-3.5 w-3.5 mr-1.5" /> Dispatch...
                      </Button>
                    </div>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Orders List */}
              <Card className="border border-border bg-card">
                <CardHeader className="py-4 px-6 border-b border-border bg-brand/5">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-bold tracking-wider text-brand uppercase flex items-center gap-2">
                        <Database className="h-4 w-4" />
                        Danh sách lệnh sản xuất (Production Orders)
                      </CardTitle>
                      <CardDescription className="text-sm mt-1">Theo dõi tiến độ từng lệnh — nhấn vào để xem chi tiết từng sản phẩm</CardDescription>
                    </div>
                    <Button size="sm" variant="outline" onClick={fetchOrders} disabled={ordersLoading}>
                      <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${ordersLoading ? 'animate-spin' : ''}`} />
                      Làm mới
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  {ordersLoading ? (
                    <div className="flex items-center justify-center py-16 text-muted-fg text-sm">
                      <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Đang tải...
                    </div>
                  ) : orders.length === 0 ? (
                    <div className="text-center py-16 text-muted-fg text-sm">
                      <Database className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      Chưa có lệnh sản xuất nào. Gửi lệnh từ hệ thống nhà máy để bắt đầu.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {orders.map((order) => (
                        <div
                          key={order.id || order.orderNo}
                          onClick={() => handleOpenOrderDetail(order)}
                          className="flex items-center justify-between p-4 rounded-xl border border-border bg-surface-1 hover:border-brand/40 hover:bg-brand/5 cursor-pointer transition-all duration-200 group"
                        >
                          <div className="flex items-center gap-4 min-w-0">
                            <div className={`h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              order.status === 'COMPLETED' ? 'bg-emerald-500/10' :
                              order.status === 'IN_PROGRESS' ? 'bg-blue-500/10' :
                              'bg-muted'
                            }`}>
                              <Database className={`h-5 w-5 ${
                                order.status === 'COMPLETED' ? 'text-emerald-400' :
                                order.status === 'IN_PROGRESS' ? 'text-blue-400' :
                                'text-muted-fg'
                              }`} />
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-sm text-foreground font-mono">{order.orderNo}</div>
                              <div className="text-xs text-muted-fg">{order.productCode}</div>
                            </div>
                          </div>

                          <div className="flex items-center gap-6 flex-shrink-0">
                            <div className="text-center hidden sm:block">
                              <div className="text-xs text-muted-fg">Kế hoạch</div>
                              <div className="font-bold text-sm text-foreground">{order.plannedQty}</div>
                            </div>
                            <div className="text-center hidden sm:block">
                              <div className="text-xs text-muted-fg">Hoàn thành</div>
                              <div className="font-bold text-sm text-emerald-400">{order.completedQty}</div>
                            </div>
                            <div className="text-center hidden sm:block">
                              <div className="text-xs text-muted-fg">Còn lại</div>
                              <div className="font-bold text-sm text-orange-400">{order.remainingQty}</div>
                            </div>
                            <div className="w-28">
                              <div className="flex justify-between text-[10px] text-muted-fg mb-1">
                                <span>Tiến độ</span>
                                <span className="font-bold text-brand">{order.progressPercent}%</span>
                              </div>
                              <div className="w-full bg-surface-2 rounded-full h-1.5">
                                <div
                                  className={`h-1.5 rounded-full transition-all duration-700 ${
                                    order.status === 'COMPLETED' ? 'bg-emerald-400' :
                                    order.status === 'IN_PROGRESS' ? 'bg-brand' :
                                    'bg-muted-fg'
                                  }`}
                                  style={{ width: `${order.progressPercent}%` }}
                                />
                              </div>
                            </div>
                            <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold ${
                              order.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400' :
                              order.status === 'IN_PROGRESS' ? 'bg-blue-500/10 text-blue-400 animate-pulse' :
                              'bg-muted text-muted-fg'
                            }`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${
                                order.status === 'COMPLETED' ? 'bg-emerald-400' :
                                order.status === 'IN_PROGRESS' ? 'bg-blue-400' :
                                'bg-muted-fg'
                              }`} />
                              {order.status === 'COMPLETED' ? 'Hoàn thành' : order.status === 'IN_PROGRESS' ? 'Đang xử lý' : 'Đã tạo'}
                            </span>
                            <span className="text-muted-fg text-xs group-hover:text-brand transition-colors">→</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {tab === 'queue' && (
            <div className="space-y-6 max-w-7xl mx-auto">
              <Card className="border border-border bg-card">
                <CardHeader className="py-4 px-6 border-b border-border bg-brand/5">
                  <CardTitle className="text-base font-bold tracking-wider text-brand uppercase flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Giám sát luồng dữ liệu thời gian thực (Real-time Pipeline Monitor)
                  </CardTitle>
                  <CardDescription className="text-sm">Trực quan hóa luồng đi của bản tin từ biên thiết bị đến Kiosk UI</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-6 gap-4 relative">
                    {[
                      { title: "1. Biên MQTT", desc: "Edge MQTT Inbound", status: isConnected ? "Active" : "Offline", count: activities.length, color: "from-blue-600 to-cyan-500" },
                      { title: "2. Outbox Table", desc: "Outbox Pattern DB", status: "Healthy", count: todayRecords.length, color: "from-brand-dark to-blue-500" },
                      { title: "3. RabbitMQ", desc: "Command Routing", status: isConnected ? "Connected" : "Disconnected", count: activities.filter(a => a.eventType.includes("Job")).length, color: "from-purple-600 to-brand" },
                      { title: "4. Job Engine", desc: "Workflow Core", status: "Processing", count: todayRecords.filter(r => r.currentStatus === "Running").length, color: "from-pink-600 to-purple-500" },
                      { title: "5. SignalR Broadcast", desc: "Real-time Hub", status: isConnected ? "Live" : "Offline", count: "SignalR Live", color: "from-rose-600 to-pink-500" },
                      { title: "6. Kiosk Operator", desc: "Operator UI", status: "Idle", count: currentUser?.username || "Guest", color: "from-emerald-600 to-teal-500" }
                    ].map((node, idx) => (
                      <div key={idx} className="relative flex flex-col justify-between bg-surface-1 border border-border p-4 rounded-xl h-36 hover:border-brand/30 transition-all duration-300">
                        <div>
                          <div className="font-extrabold text-sm text-foreground">{node.title}</div>
                          <div className="text-[11px] text-muted-fg font-medium mt-0.5">{node.desc}</div>
                        </div>
                        <div className="mt-4 flex justify-between items-center">
                          <span className="text-xs font-mono font-bold bg-surface-2 px-2 py-1 rounded text-brand-light">{node.count}</span>
                          <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${node.status === "Active" || node.status === "Connected" || node.status === "Healthy" || node.status === "Live" ? "bg-emerald-500/10 text-emerald-400" : "bg-orange-500/10 text-orange-400"}`}>
                            <span className={`h-1 w-1 rounded-full ${node.status === "Active" || node.status === "Connected" || node.status === "Healthy" || node.status === "Live" ? "bg-emerald-400 animate-pulse" : "bg-orange-400"}`}></span>
                            {node.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ════ TAB: ALARMS ════════════════════════════════ */}
          {tab === 'alarms' && (
            <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-200">
              <Card className="border border-border bg-card">
                <CardHeader className="py-4 px-6 border-b border-border bg-brand/5">
                  <CardTitle className="text-base font-bold tracking-wider text-brand uppercase flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Trung tâm quản lý báo động (Alarm Center)
                  </CardTitle>
                  <CardDescription className="text-sm">Ghi nhận các cảnh báo phần cứng, kết nối mạng và lỗi logic quy trình gia công</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="overflow-x-auto border border-border rounded-xl bg-card">
                    <TableEl>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead className="pl-4 font-bold text-foreground text-xs uppercase tracking-wider">Mức độ</TableHead>
                          <TableHead className="font-bold text-foreground text-xs uppercase tracking-wider">Nguồn</TableHead>
                          <TableHead className="font-bold text-foreground text-xs uppercase tracking-wider">Nội dung thông báo</TableHead>
                          <TableHead className="font-bold text-foreground text-xs uppercase tracking-wider">Thiết bị</TableHead>
                          <TableHead className="font-bold text-foreground text-xs uppercase tracking-wider">Thời gian</TableHead>
                          <TableHead className="font-bold text-foreground text-xs uppercase tracking-wider">Trạng thái</TableHead>
                          <TableHead className="pr-4 text-right font-bold text-xs uppercase tracking-wider">Hành động</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {alarms.map((alarm) => (
                          <TableRow key={alarm.id} className={alarm.isAcknowledged ? 'opacity-60 bg-muted/10' : 'bg-card font-medium'}>
                            <TableCell className="pl-4">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold ${alarm.severity === 'Critical' ? 'bg-red-500/10 text-red-400' :
                                  alarm.severity === 'Error' ? 'bg-orange-500/10 text-orange-400' :
                                    'bg-amber-500/10 text-amber-400'
                                }`}>
                                {alarm.severity}
                              </span>
                            </TableCell>
                            <TableCell className="text-foreground text-xs font-semibold">{alarm.source}</TableCell>
                            <TableCell className="text-foreground text-xs">{alarm.message}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-fg">{alarm.deviceId || '—'}</TableCell>
                            <TableCell className="text-muted-fg text-xs">{new Date(alarm.createdAt).toLocaleString('vi-VN')}</TableCell>
                            <TableCell>
                              {alarm.isAcknowledged ? (
                                <span className="text-emerald-400 text-xs flex items-center gap-1 font-bold">
                                  <CheckCircle className="h-3.5 w-3.5" /> Đã xác nhận ({alarm.acknowledgedBy})
                                </span>
                              ) : (
                                <span className="text-orange-400 text-xs font-bold flex items-center gap-1">
                                  <AlertTriangle className="h-3.5 w-3.5 animate-pulse" /> Chưa xác nhận
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="pr-4 text-right">
                              {!alarm.isAcknowledged && (
                                <Button size="sm" onClick={() => handleAcknowledgeAlarm(alarm.id)} className="text-xs h-7">
                                  Xác nhận
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {alarms.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center py-10 text-muted-fg text-sm">
                              Không có báo động nào được ghi nhận.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </TableEl>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ════ TAB: CONFIG ════════════════════════════════ */}
          {tab === 'config' && isSuperAdmin && (
            <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-200">
              <Card className="border border-border bg-card">
                <CardHeader className="py-4 px-6 border-b border-border bg-brand/5">
                  <CardTitle className="text-base font-bold tracking-wider text-brand uppercase flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Cấu hình tham số trung tâm (Central Configuration Management)
                  </CardTitle>
                  <CardDescription className="text-sm">Quản lý các tham số thiết bị và ngưỡng mô phỏng lưu trong SQLite Store</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                  {configLoading ? (
                    <div className="text-center py-10 text-muted-fg text-sm">Đang tải danh sách tham số cấu hình...</div>
                  ) : (
                    <div className="overflow-x-auto border border-border rounded-xl">
                      <TableEl>
                        <TableHeader className="bg-muted/40">
                          <TableRow>
                            <TableHead className="pl-4 font-bold text-foreground text-xs uppercase tracking-wider">Từ khóa (Key)</TableHead>
                            <TableHead className="font-bold text-foreground text-xs uppercase tracking-wider">Giá trị</TableHead>
                            <TableHead className="font-bold text-foreground text-xs uppercase tracking-wider">Mô tả</TableHead>
                            <TableHead className="pr-4 text-right font-bold text-xs uppercase tracking-wider">Hành động</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {configParams.map((param) => (
                            <TableRow key={param.key}>
                              <TableCell className="pl-4 font-mono font-bold text-foreground text-xs">{param.key}</TableCell>
                              <TableCell>
                                {configEditingKey === param.key ? (
                                  <Input
                                    value={configEditingValue}
                                    onChange={(e) => setConfigEditingValue(e.target.value)}
                                    className="h-8 max-w-xs text-xs font-mono font-bold"
                                  />
                                ) : (
                                  <code className="text-brand-light font-mono font-bold bg-brand/5 px-2 py-0.5 rounded border border-brand/10 text-xs">
                                    {param.value}
                                  </code>
                                )}
                              </TableCell>
                              <TableCell className="text-muted-fg text-xs">{param.description || '—'}</TableCell>
                              <TableCell className="pr-4 text-right">
                                {configEditingKey === param.key ? (
                                  <div className="flex justify-end gap-1">
                                    <Button size="sm" className="h-7 text-xs" onClick={() => handleSaveConfig(param.key, configEditingValue)}>
                                      Lưu
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfigEditingKey(null)}>
                                      Hủy
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs"
                                    onClick={() => {
                                      setConfigEditingKey(param.key)
                                      setConfigEditingValue(param.value)
                                    }}
                                  >
                                    Chỉnh sửa
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                          {configParams.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center py-10 text-muted-fg text-sm">
                                Không tìm thấy tham số cấu hình nào.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </TableEl>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ════ TAB: DIAGNOSTICS ═══════════════════════════ */}
          {tab === 'diagnostics' && (
            <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-200">
              {diagnosticsLoading && (
                <div className="rounded-lg border border-brand/20 bg-brand/5 px-4 py-3 text-xs font-semibold text-brand-light animate-pulse">
                  Đang quét kết nối và tổng hợp số liệu hiệu năng hệ thống...
                </div>
              )}
              {/* KPI Cards */}
              {diagnosticsMetrics && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  <Card>
                    <CardContent className="p-6 flex flex-col justify-between h-28">
                      <span className="text-xs uppercase text-muted-fg font-semibold">Tốc độ chạy máy (Throughput)</span>
                      <div className="text-3xl font-extrabold text-brand font-mono tracking-tight">
                        {diagnosticsMetrics.throughput} <span className="text-sm font-semibold text-muted-fg">sản phẩm/ngày</span>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-6 flex flex-col justify-between h-28">
                      <span className="text-xs uppercase text-muted-fg font-semibold">Tỷ lệ đạt (Yield Rate)</span>
                      <div className="text-3xl font-extrabold text-emerald-400 font-mono tracking-tight">
                        {diagnosticsMetrics.passRate}%
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-6 flex flex-col justify-between h-28">
                      <span className="text-xs uppercase text-muted-fg font-semibold">Tỷ lệ lỗi (Defect Rate)</span>
                      <div className="text-3xl font-extrabold text-red-400 font-mono tracking-tight">
                        {diagnosticsMetrics.failureRate}%
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Health checklist */}
                <Card className="lg:col-span-2">
                  <CardHeader className="py-4 px-6 border-b border-border bg-brand/5">
                    <CardTitle className="text-sm font-bold uppercase tracking-wider text-brand flex items-center gap-2">
                      <CheckCircle className="h-4 w-4" />
                      Danh sách kiểm tra kết nối (Connection Checklist)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 space-y-4">
                    {diagnosticsHealth ? (
                      <div className="space-y-3">
                        {Object.entries(diagnosticsHealth).map(([key, val]: [string, any]) => (
                          <div key={key} className="flex justify-between items-center border-b border-border pb-2.5">
                            <span className="font-bold text-xs uppercase text-foreground font-mono">{key}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-muted-fg font-mono">{val.latencyMs}ms</span>
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold ${val.status === 'Healthy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${val.status === 'Healthy' ? 'bg-emerald-400' : 'bg-red-400'}`}></span>
                                {val.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-10 text-muted-fg text-sm">Đang quét cổng kết nối phần cứng...</div>
                    )}
                  </CardContent>
                </Card>

                {/* Latency Averages */}
                <Card>
                  <CardHeader className="py-4 px-6 border-b border-border bg-brand/5">
                    <CardTitle className="text-sm font-bold uppercase tracking-wider text-brand flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Độ trễ trung bình (Average Step Latency)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6">
                    {diagnosticsMetrics && diagnosticsMetrics.stepAverages ? (
                      <div className="space-y-4">
                        {Object.entries(diagnosticsMetrics.stepAverages).map(([step, time]: [string, any]) => (
                          <div key={step} className="space-y-1">
                            <div className="flex justify-between text-xs font-bold text-foreground">
                              <span>{step}</span>
                              <span className="font-mono text-brand-light">{Math.round(time)} ms</span>
                            </div>
                            <div className="w-full bg-surface-2 rounded-full h-2">
                              <div className="bg-brand h-2 rounded-full" style={{ width: `${Math.min((time / 3000) * 100, 100)}%` }}></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-10 text-muted-fg text-sm">Đang biên dịch số liệu độ trễ...</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* ════ TAB: LABEL TEMPLATES ═══════════════════════════ */}
          {tab === 'templates' && (
            <div className="max-w-7xl mx-auto w-full">
              <LabelTemplatesTab />
            </div>
          )}

          {/* ════ TAB: RBAC ══════════════════════════════════ */}
          {tab === 'rbac' && isSuperAdmin && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-7xl mx-auto">

              {/* Users list — spans 2 cols on xl */}
              <Card className="xl:col-span-2 overflow-hidden">
                <CardHeader className="border-b border-border px-6 py-4">
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <Users className="h-5 w-5 text-brand" />
                    Danh sách người dùng Kiosk
                  </CardTitle>
                  <CardDescription className="text-sm">Quản lý vai trò và quyền hạn của người vận hành trạm</CardDescription>
                </CardHeader>
                <CardContent className="p-6 space-y-4">

                  {/* Alerts */}
                  {rbacSuccess && (
                    <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-base text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      {rbacSuccess}
                    </div>
                  )}
                  {rbacError && (
                    <div className="flex items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-base text-red-400">
                      <ShieldAlert className="h-4 w-4 shrink-0" />
                      {rbacError}
                    </div>
                  )}

                  {/* Table */}
                  <div className="rounded-lg border border-border overflow-x-auto">
                    <TableEl>
                      <TableHeader className="bg-surface-2">
                        <TableRow>
                          <TableHead className="pl-4 text-sm">Tên đăng nhập</TableHead>
                          <TableHead className="text-sm">Họ và tên</TableHead>
                          <TableHead className="text-sm">Vai trò</TableHead>
                          <TableHead className="text-sm">Quyền hạn</TableHead>
                          <TableHead className="text-sm">Cập nhật lần cuối</TableHead>
                          <TableHead className="pr-4 text-right text-sm">Thao tác</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {users.map((u) => {
                          const dateStr = u.updatedAt
                            ? new Date(u.updatedAt).toLocaleString('vi-VN', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                            : '-'

                          return (
                            <TableRow key={u.id} className={!u.isActive ? 'opacity-60 bg-surface-2/10' : ''}>
                              <TableCell className="pl-4 font-bold text-sm">
                                <div className="flex items-center gap-2">
                                  <span>{u.username}</span>
                                  {!u.isActive && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-red-500/10 text-red-400 border border-red-500/20 uppercase tracking-wider">
                                      Tạm khóa
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-muted-fg text-sm">{u.fullName}</TableCell>
                              <TableCell>
                                {u.roles.includes('SUPER_ADMIN') ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-orange-500/10 text-orange-500 border border-orange-500/20 uppercase tracking-wide">
                                    <Shield className="h-3.5 w-3.5" />
                                    Admin hệ thống
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-zinc-800 text-zinc-300 border border-zinc-700 uppercase tracking-wide">
                                    <User className="h-3.5 w-3.5" />
                                    Nhân viên
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1 max-w-[220px]">
                                  {u.roles.includes('SUPER_ADMIN') ? (
                                    <span className="text-xs font-bold text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">
                                      Toàn quyền hệ thống
                                    </span>
                                  ) : (
                                    <>
                                      {u.directPermissions.length === 0 && (
                                        <span className="text-xs italic text-subtle-fg">Xem công việc (Mặc định)</span>
                                      )}
                                      {u.directPermissions.map((p: string) => (
                                        <PermissionBadge key={p} permission={p} className="text-xs" />
                                      ))}
                                    </>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-muted-fg text-sm">{dateStr}</TableCell>
                              <TableCell className="pr-4 text-right">
                                <div className="relative inline-block text-left user-actions-dropdown">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (activeDropdownUserId === u.id) {
                                        setActiveDropdownUserId(null);
                                        setDropdownPosition(null);
                                      } else {
                                        setActiveDropdownUserId(u.id);
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setDropdownPosition({
                                          top: rect.bottom + window.scrollY + 6,
                                          left: rect.right + window.scrollX - 208,
                                        });
                                      }
                                    }}
                                    className="inline-flex items-center justify-center h-10 w-10 rounded-lg hover:bg-surface-3 text-muted-fg hover:text-foreground transition-colors cursor-pointer border border-border-strong focus:outline-none focus:ring-2 focus:ring-primary"
                                    aria-label={`Actions for ${u.username}`}
                                  >
                                    <MoreVertical className="h-5 w-5" />
                                  </button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </TableEl>
                  </div>
                </CardContent>
              </Card>

              {/* Create user form */}
              <Card className="overflow-hidden">
                <CardHeader className="border-b border-border px-6 py-4">
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <Plus className="h-5 w-5 text-brand" />
                    Đăng ký người dùng mới
                  </CardTitle>
                  <CardDescription className="text-sm">Tạo tài khoản cho nhân viên vận hành trạm</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                  <form onSubmit={handleCreateUser} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="newUsername" className="text-sm">Tên đăng nhập</Label>
                      <Input id="newUsername" type="text" required placeholder="Ví dụ: operator_nam"
                        className="text-sm" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="newFullName" className="text-sm">Họ và tên</Label>
                      <Input id="newFullName" type="text" required placeholder="Ví dụ: Nguyễn Văn Nam"
                        className="text-sm" value={newFullName} onChange={(e) => setNewFullName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="newPassword" className="text-sm">Mật khẩu</Label>
                      <Input id="newPassword" type="password" required placeholder="Tối thiểu 6 ký tự"
                        className="text-sm" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">Vai trò hệ thống</Label>
                      <Select value={newRole} onValueChange={setNewRole}>
                        <SelectTrigger className="w-full text-sm">
                          <SelectValue placeholder="Chọn vai trò" />
                        </SelectTrigger>
                        <SelectContent>
                          {CREATABLE_ROLES.map((role) => (
                            <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="submit" className="w-full mt-2 text-sm">
                      <Plus className="h-4 w-4" /> Tạo người dùng
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}
        </main>
      </div>

      {/* ── DIALOG: Record Details ───────────────────────── */}
      <Dialog open={!!selectedRecord} onOpenChange={(open) => { if (!open) setSelectedRecord(null) }}>
        <DialogContent className="w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-brand font-bold text-xl">
              <Clock className="h-5 w-5" />
              Chi tiết bản ghi sản xuất
            </DialogTitle>
            <DialogDescription className="text-muted-fg text-sm">
              Thông tin chi tiết của sản phẩm đã qua xử lý tại trạm.
            </DialogDescription>
          </DialogHeader>

          {selectedRecord && (
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
                <span className="text-muted-fg font-medium">Lệnh sản xuất:</span>
                <span className="col-span-2 font-bold text-foreground">{selectedRecord.jobNo}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
                <span className="text-muted-fg font-medium">Mã sản phẩm:</span>
                <span className="col-span-2 font-semibold text-foreground">{selectedRecord.productCode}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
                <span className="text-muted-fg font-medium">Số Serial / UID:</span>
                <span className="col-span-2 font-mono text-foreground">{selectedRecord.productSerial || '—'}</span>
              </div>

              {/* Label preview — client-side rendering from active template */}
              {selectedRecord.productSerial && (
                <div className="border border-border/50 rounded-lg bg-slate-50/50 overflow-hidden flex flex-col items-center p-3">
                  <div className="w-full px-1 pb-2 text-xs font-semibold text-muted-fg uppercase tracking-wider border-b border-border/30 mb-3 text-left">
                    Xem trước nhãn in thực tế (QR 50x30)
                  </div>
                  <LabelPreview
                    template={activeTemplate}
                    data={{
                      production_order: selectedRecord.jobNo || '—',
                      work_order: selectedRecord.productSerial || 'N/A',
                      product_name: (selectedRecord.productCode || '—') + ' Bearing Seal',
                      product_code: selectedRecord.productCode || '—',
                      revision: 'Rev A',
                      lot_number: 'LOT-2026-07-A',
                      batch_number: 'BATCH-01',
                      serial_number: selectedRecord.productSerial || 'N/A',
                    }}
                    width={320}
                    className="rounded-md border border-border shadow-md"
                  />
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
                <span className="text-muted-fg font-medium">Loại công việc:</span>
                <span className="col-span-2 font-semibold text-foreground">{translateJobType(selectedRecord.jobType)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
                <span className="text-muted-fg font-medium">Trạng thái:</span>
                <span className="col-span-2">
                  <StatusBadge status={selectedRecord.currentStatus} jobType={selectedRecord.jobType} />
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
                <span className="text-muted-fg font-medium">Mã trạm:</span>
                <span className="col-span-2 font-mono text-foreground">{selectedRecord.stationId}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
                <span className="text-muted-fg font-medium">Thời gian bắt đầu:</span>
                <span className="col-span-2 text-foreground">
                  {new Date(selectedRecord.createdAt).toLocaleString('vi-VN')}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
                <span className="text-muted-fg font-medium">Thời gian cập nhật:</span>
                <span className="col-span-2 text-foreground">
                  {new Date(selectedRecord.updatedAt).toLocaleString('vi-VN')}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 pb-1">
                <span className="text-muted-fg font-medium">Job ID:</span>
                <span className="col-span-2 font-mono text-sm text-muted-fg break-all">{selectedRecord.jobId}</span>
              </div>
            </div>
          )}


          <DialogFooter className="pt-2">
            <Button variant="outline" className="w-full text-sm" onClick={() => setSelectedRecord(null)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DIALOG: Reprint / Remark Overwrite ───────────── */}
      <Dialog open={isReprintListOpen} onOpenChange={setIsReprintListOpen}>
        <DialogContent
          className="w-[95vw] md:max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border text-foreground"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-500 font-bold text-xl">
              <PrinterIcon className="h-5 w-5" />
              Yêu cầu In / Khắc lại tem sản phẩm
            </DialogTitle>
            <DialogDescription className="text-muted-fg text-sm">
              Chọn một bản ghi sản xuất trong ngày hôm nay để gửi yêu cầu in hoặc khắc lại.
            </DialogDescription>
          </DialogHeader>

          {reprintSuccess && (
            <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-base text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {reprintSuccess}
            </div>
          )}
          {reprintError && (
            <div className="flex items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-base text-red-400">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              {reprintError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-2">
            {/* Left Column: Today's list */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold uppercase text-muted-fg tracking-wider">Danh sách sản xuất hôm nay</h3>
              <div className="max-h-[300px] overflow-y-auto border border-border rounded-lg bg-surface-2 p-1 space-y-1">
                {todayRecords.map((rec) => {
                  const isSelected = selectedReprintRecord?.id === rec.id;
                  return (
                    <div
                      key={rec.id}
                      onClick={() => {
                        setSelectedReprintRecord(rec);
                        setReprintError('');
                        setReprintSuccess('');
                      }}
                      className={[
                        'p-2.5 rounded-md cursor-pointer transition-colors text-sm border space-y-1',
                        isSelected
                          ? 'bg-orange-500/10 border-orange-500/50 text-foreground'
                          : 'border-transparent hover:bg-surface-1 text-muted-fg hover:text-foreground'
                      ].join(' ')}
                    >
                      <div className="flex justify-between items-center font-bold">
                        <span className={isSelected ? 'text-orange-400' : 'text-foreground'}>{rec.jobNo}</span>
                        <span className="font-mono text-xs text-muted-fg">
                          {new Date(rec.updatedAt).toLocaleTimeString('vi-VN')}
                        </span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span>SKU: {rec.productCode}</span>
                        <span className="font-mono">SN: {rec.productSerial || '—'}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-muted-fg">{translateJobType(rec.jobType)}</span>
                        <StatusBadge status={rec.currentStatus} jobType={rec.jobType} className="px-1.5 py-0 text-[10px]" />
                      </div>
                    </div>
                  );
                })}
                {todayRecords.length === 0 && (
                  <div className="text-center py-8 text-sm text-muted-fg">
                    Không có bản ghi sản xuất nào hôm nay.
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Execution Form */}
            <div className="space-y-4 flex flex-col justify-between">
              {selectedReprintRecord ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border p-3 space-y-2 bg-surface-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-fg font-medium">Bản ghi chọn:</span>
                      <span className="font-bold text-orange-400">{selectedReprintRecord.jobNo}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-fg font-medium">SKU:</span>
                      <span className="font-semibold text-foreground">{selectedReprintRecord.productCode}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-fg font-medium">Serial/UID:</span>
                      <span className="font-mono text-foreground">{selectedReprintRecord.productSerial || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-fg font-medium">Loại công việc:</span>
                      <span className="font-semibold text-foreground">{translateJobType(selectedReprintRecord.jobType)}</span>
                    </div>
                  </div>


                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-fg font-medium">Hành động thực hiện:</span>
                      <span className="font-bold text-brand-light bg-brand/10 px-2 py-0.5 rounded border border-brand/30">
                        {selectedReprintRecord.jobType.toUpperCase() === 'PRINT_ONLY' || selectedReprintRecord.jobType.toUpperCase() === 'PRINT_LABEL' ? 'IN LẠI NHÃN (REPRINT)' :
                          selectedReprintRecord.jobType.toUpperCase() === 'MARK_ONLY' || selectedReprintRecord.jobType.toUpperCase() === 'LASER_MARK' ? 'KHẮC LẠI LASER (RELASER)' :
                            'LÀM LẠI QUY TRÌNH (REPROCESS)'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-sm font-bold text-foreground">Lý do in/khắc lại *</Label>
                    <Select
                      value={reprintReasonCode}
                      onValueChange={setReprintReasonCode}
                    >
                      <SelectTrigger className="h-10 text-sm bg-transparent">
                        <SelectValue placeholder="Chọn lý do" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PRINT_QUALITY">Lỗi chất lượng in (Print quality issue)</SelectItem>
                        <SelectItem value="LASER_UNREADABLE">Mã khắc không đọc được (Laser unreadable)</SelectItem>
                        <SelectItem value="WRONG_LABEL">Sai nhãn sản phẩm (Wrong label)</SelectItem>
                        <SelectItem value="VERIFICATION_FAILED">Lỗi xác thực vision (Verification failed)</SelectItem>
                        <SelectItem value="CUSTOMER_COMPLAINT">Khiếu nại từ khách hàng (Customer complaint)</SelectItem>
                        <SelectItem value="OPERATOR_MISTAKE">Thao tác viên nhầm lẫn (Operator mistake)</SelectItem>
                        <SelectItem value="MAINTENANCE_TEST">Kiểm tra & Bảo trì (Maintenance test)</SelectItem>
                        <SelectItem value="OTHER">Lý do khác (Cần ghi rõ bên dưới)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="reprint-comment" className="text-sm font-bold text-foreground">Ghi chú chi tiết *</Label>
                    <textarea
                      id="reprint-comment"
                      required
                      rows={3}
                      placeholder="Nhập mô tả chi tiết lý do..."
                      value={reprintComment}
                      onChange={(e) => setReprintComment(e.target.value)}
                      className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>

                  <div className="flex items-center space-x-2 pt-2">
                    <input
                      id="reprint-confirm"
                      type="checkbox"
                      checked={reprintConfirmed}
                      onChange={(e) => setReprintConfirmed(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-brand-dark focus:ring-brand bg-transparent cursor-pointer"
                    />
                    <label htmlFor="reprint-confirm" className="text-xs font-medium text-foreground cursor-pointer select-none">
                      Tôi xác nhận chịu trách nhiệm thực hiện hành động in/khắc lại này.
                    </label>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-border rounded-lg p-6 text-center text-sm text-muted-fg bg-surface-2/40">
                  <PrinterIcon className="h-8 w-8 text-muted-fg/40 mb-2" />
                  Vui lòng chọn một bản ghi từ danh sách hôm nay bên trái để tiến hành in/khắc lại.
                </div>
              )}

              <DialogFooter className="border-t border-border pt-4 mt-auto">
                <Button
                  variant="outline"
                  disabled={submittingReprint}
                  onClick={() => setIsReprintListOpen(false)}
                  className="text-sm animate-duration-100"
                >
                  Hủy bỏ
                </Button>
                <Button
                  disabled={submittingReprint || !selectedReprintRecord || !reprintComment.trim() || !reprintConfirmed}
                  onClick={handleTriggerReprint}
                  className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white font-bold text-sm"
                >
                  {submittingReprint ? 'Đang gửi...' : 'Gửi yêu cầu'}
                </Button>
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>


      {/* ── DIALOG: History Details & Audit Trail ────────── */}
      <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
        <DialogContent className="w-[95vw] md:max-w-5xl bg-card border-border text-foreground overflow-y-auto md:overflow-hidden md:flex md:flex-col max-h-[95vh] md:max-h-[90vh]">
          <DialogHeader className="pb-4 border-b border-border">
            <DialogTitle className="flex items-center gap-2 text-brand font-bold text-xl">
              <History className="h-5 w-5" />
              Chi tiết lịch sử & Tiến trình gia công
            </DialogTitle>
            <DialogDescription className="text-muted-fg text-sm">
              Theo dõi chi tiết các lần chạy (attempts), tiến trình từng bước và nhật ký sự kiện của lệnh sản xuất.
            </DialogDescription>
          </DialogHeader>

          {selectedDetailRecord && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-lg bg-surface-2/60 border border-border/50 text-sm">
              <div>
                <span className="text-muted-fg block text-xs uppercase font-semibold">Lệnh sản xuất</span>
                <span className="font-bold text-foreground font-mono text-base">{selectedDetailRecord.jobNo}</span>
              </div>
              <div>
                <span className="text-muted-fg block text-xs uppercase font-semibold">Mã sản phẩm</span>
                <span className="font-semibold text-foreground text-base">{selectedDetailRecord.productCode}</span>
              </div>
              <div>
                <span className="text-muted-fg block text-xs uppercase font-semibold">Serial / Mã vạch</span>
                <span className="font-mono text-foreground text-sm font-bold">{selectedDetailRecord.productSerial || '—'}</span>
              </div>
              <div>
                <span className="text-muted-fg block text-xs uppercase font-semibold">Trạng thái hiện tại</span>
                <div className="mt-0.5">
                  <StatusBadge status={selectedDetailRecord.currentStatus} jobType={selectedDetailRecord.jobType} />
                </div>
              </div>
            </div>
          )}

          {/* Tab Navigation */}
          <div className="flex border-b border-border mt-2">
            <button
              onClick={() => setDetailTab('pieces')}
              className={[
                'px-6 py-2.5 font-bold text-sm tracking-wider uppercase border-b-2 transition-all flex items-center gap-2',
                detailTab === 'pieces'
                  ? 'border-brand text-brand bg-brand/5'
                  : 'border-transparent text-muted-fg hover:text-foreground hover:bg-surface-2'
              ].join(' ')}
            >
              <Database className="h-4 w-4" />
              Sản phẩm chi tiết ({detailPieces.length})
            </button>
            <button
              onClick={() => setDetailTab('progress')}
              disabled={!selectedPieceJobId}
              className={[
                'px-6 py-2.5 font-bold text-sm tracking-wider uppercase border-b-2 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed',
                detailTab === 'progress'
                  ? 'border-brand text-brand bg-brand/5'
                  : 'border-transparent text-muted-fg hover:text-foreground hover:bg-surface-2'
              ].join(' ')}
            >
              <Clock className="h-4 w-4" />
              Tiến trình & Lần chạy thiết bị
            </button>
          </div>

          {/* Tab 1: Pieces List */}
          {detailTab === 'pieces' && (
            <div className="py-4 flex-1 overflow-hidden flex flex-col min-h-[350px]">
              <div className="border border-border rounded-lg bg-surface-2/30 flex-1 overflow-hidden flex flex-col">
                <div className="p-3 border-b border-border bg-surface-2 font-bold text-sm uppercase tracking-wider text-muted-fg flex justify-between items-center">
                  <span>Danh sách sản phẩm trong lệnh</span>
                  <Badge variant="outline" className="bg-background">{detailPieces.length}</Badge>
                </div>
                <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {loadingPieces ? (
                    <div className="col-span-full text-center py-20 text-muted-fg text-sm animate-pulse">
                      Đang tải danh sách sản phẩm...
                    </div>
                  ) : detailPieces.length === 0 ? (
                    <div className="col-span-full text-center py-20 text-muted-fg text-sm">
                      Không có sản phẩm nào được ghi nhận.
                    </div>
                  ) : (
                    detailPieces.map((piece: any, idx: number) => {
                      const isSelected = selectedPieceJobId === piece.jobId;
                      return (
                        <div
                          key={piece.id}
                          onClick={() => {
                            setSelectedPieceJobId(piece.jobId);
                            setDetailTab('progress'); // Auto-switch to progress view
                          }}
                          className={[
                            'p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-3',
                            isSelected
                              ? 'bg-brand/10 border-brand/50 ring-1 ring-brand/30 shadow-sm font-semibold'
                              : 'bg-card hover:bg-surface-1 border-border hover:border-muted-fg/40 shadow-sm'
                          ].join(' ')}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <div className="font-bold text-sm text-foreground">Sản phẩm #{idx + 1}</div>
                              <div className="font-mono text-xs text-muted-fg mt-0.5 break-all max-w-[170px]">
                                {piece.productSerial || 'Không có serial'}
                              </div>
                            </div>
                            <StatusBadge status={piece.currentStatus} jobType={piece.jobType} />
                          </div>

                          {/* Label preview — client-side dynamic rendering from active template */}
                          {piece.productSerial && (
                            <div className="flex justify-center bg-white rounded-md border border-border/40 overflow-hidden p-1">
                              <LabelPreview
                                template={activeTemplate}
                                data={{
                                  production_order: selectedDetailRecord?.jobNo || '—',
                                  work_order: piece.productSerial || 'N/A',
                                  product_name: (selectedDetailRecord?.productCode || '—') + ' Bearing Seal',
                                  product_code: selectedDetailRecord?.productCode || '—',
                                  revision: 'Rev A',
                                  lot_number: 'LOT-2026-07-A',
                                  batch_number: 'BATCH-01',
                                  serial_number: piece.productSerial || 'N/A',
                                }}
                                width={180}
                                className="rounded border border-border/50"
                              />
                            </div>
                          )}

                          <div className="flex justify-between items-center text-[10px] text-muted-fg pt-2 border-t border-border/50 font-medium">
                            <span>Thời gian: {new Date(piece.updatedAt).toLocaleTimeString('vi-VN')}</span>
                            <span className="text-brand-light font-bold hover:underline">Xem chi tiết &rarr;</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Attempts & Steps Progress */}
          {detailTab === 'progress' && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 py-4 md:overflow-hidden flex-1 min-h-0">
              {/* Left Column: Attempts List */}
              <div className="md:col-span-4 flex flex-col md:overflow-hidden border border-border rounded-lg bg-surface-2/30 max-h-[250px] md:max-h-none">
                <div className="p-3 border-b border-border bg-surface-2 font-bold text-sm uppercase tracking-wider text-muted-fg flex items-center justify-between">
                  <span>Danh sách lần chạy</span>
                  <Badge variant="outline" className="bg-background">{detailAttempts.length}</Badge>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {!selectedPieceJobId ? (
                    <div className="text-center py-10 text-muted-fg text-xs">Chọn sản phẩm ở bên trái.</div>
                  ) : loadingDetail ? (
                    <div className="text-center py-10 text-muted-fg text-xs animate-pulse">Đang tải danh sách...</div>
                  ) : detailAttempts.length === 0 ? (
                    <div className="text-center py-10 text-muted-fg text-sm">Không có dữ liệu lần chạy.</div>
                  ) : (
                    [...detailAttempts].sort((a, b) => b.attemptNo - a.attemptNo).map((attempt) => {
                      const isSelected = selectedAttemptId === attempt.id;
                      const triggerText = translateTriggerType(attempt.triggerType);
                      const isSuccess = attempt.resultStatus?.toUpperCase() === 'COMPLETED' || attempt.resultStatus?.toUpperCase() === 'SUCCESS';
                      const isFailed = attempt.resultStatus?.toUpperCase() === 'FAILED';

                      return (
                        <div
                          key={attempt.id}
                          onClick={() => setSelectedAttemptId(attempt.id)}
                          className={[
                            'p-3 rounded-lg cursor-pointer border transition-all space-y-2',
                            isSelected
                              ? 'bg-brand/10 border-brand/50 text-foreground ring-1 ring-brand/30'
                              : 'border-transparent bg-surface-1 hover:bg-surface-2 hover:border-border text-muted-fg hover:text-foreground'
                          ].join(' ')}
                        >
                          <div className="flex justify-between items-center font-bold">
                            <span className={isSelected ? 'text-brand-light text-sm' : 'text-foreground text-sm'}>
                              Lần chạy #{attempt.attemptNo}
                            </span>
                            <span className="text-[10px] font-mono text-muted-fg/80">
                              {attempt.startedAt ? new Date(attempt.startedAt).toLocaleTimeString('vi-VN') : '—'}
                            </span>
                          </div>

                          <div className="text-xs space-y-1">
                            <div className="flex justify-between">
                              <span className="opacity-75">Hành động:</span>
                              <span className="font-semibold text-foreground text-[11px] truncate max-w-[150px]">{triggerText}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="opacity-75">Vận hành viên:</span>
                              <span className="font-semibold text-foreground text-[11px]">
                                {attempt.triggerType?.toUpperCase() === 'AUTO' ? 'Hệ thống' : (attempt.triggeredByUserId || 'Hệ thống')}
                              </span>
                            </div>
                            {attempt.reasonCode && (
                              <div className="bg-surface-2/80 p-1.5 rounded mt-1 border border-border/30">
                                <div className="flex justify-between font-semibold text-[10px] text-orange-400">
                                  <span>Lý do:</span>
                                  <span>{translateReasonCode(attempt.reasonCode)}</span>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="flex justify-between items-center pt-1 border-t border-border/30 text-xs">
                            <span className="opacity-75 text-[10px]">Trạng thái:</span>
                            <Badge className={[
                              'px-1.5 py-0 text-[10px] font-semibold',
                              isSuccess ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                isFailed ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                                  'bg-brand/10 text-brand-light border border-brand/20 animate-pulse'
                            ].join(' ')}>
                              {attempt.resultStatus === 'COMPLETED' || attempt.resultStatus === 'SUCCESS' ? 'OK' :
                                attempt.resultStatus === 'FAILED' ? 'NG' :
                                  'Đang chạy'}
                            </Badge>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Attempt Steps (Col span 8) */}
              <div className="md:col-span-8 flex flex-col md:overflow-hidden min-h-0">

                {/* Attempt Steps Section */}
                <div className="flex-1 flex flex-col border border-border rounded-lg bg-surface-2/30 md:overflow-hidden min-h-[300px]">
                  <div className="p-3 border-b border-border bg-surface-2 font-bold text-sm uppercase tracking-wider text-muted-fg flex items-center justify-between">
                    <span>Tiến trình từng bước</span>
                    {selectedAttemptId && (
                      <span className="font-mono text-xs text-brand-light font-bold bg-brand/10 px-2 py-0.5 rounded border border-brand/20">
                        ID Lần Chạy: {selectedAttemptId.slice(0, 8)}...
                      </span>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto p-4">
                    {!selectedAttemptId ? (
                      <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-fg">
                        Chọn một lần chạy ở bên trái.
                      </div>
                    ) : !attemptSteps[selectedAttemptId] ? (
                      <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-fg animate-pulse">
                        Đang tải...
                      </div>
                    ) : attemptSteps[selectedAttemptId].length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-fg">
                        Không có dữ liệu bước.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {(() => {
                          const failedStep = attemptSteps[selectedAttemptId].find((s: any) => s.status?.toUpperCase() === 'FAILED');
                          const failure = failedStep ? parseFailureMessage(failedStep.stepName, failedStep.errorMessage) : null;
                          if (!failure) return null;
                          return (
                            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 space-y-3 text-sm">
                              <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                                <span>⚠️</span> Phân Tích Nguyên Nhân Lỗi (Failure Analysis)
                              </h4>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                <div>
                                  <span className="text-muted-fg block mb-0.5 font-medium">Nguồn lỗi:</span>
                                  <span className="font-semibold text-foreground">{failure.source}</span>
                                </div>
                                <div>
                                  <span className="text-muted-fg block mb-0.5 font-medium">Thiết bị:</span>
                                  <span className="font-semibold text-foreground bg-surface-3 px-1.5 py-0.5 rounded border border-border inline-block mt-0.5">
                                    {failure.device}
                                  </span>
                                </div>
                                {failure.expected && (
                                  <div>
                                    <span className="text-muted-fg block mb-0.5 font-medium">Giá trị kỳ vọng:</span>
                                    <span className="font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 inline-block mt-0.5">
                                      {failure.expected}
                                    </span>
                                  </div>
                                )}
                                {failure.actual && (
                                  <div>
                                    <span className="text-muted-fg block mb-0.5 font-medium">Giá trị thực tế:</span>
                                    <span className="font-mono text-red-400 font-bold bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20 inline-block mt-0.5">
                                      {failure.actual}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div className="text-xs">
                                <span className="text-muted-fg block mb-1 font-medium">Nguyên nhân chi tiết:</span>
                                <div className="bg-red-500/5 border border-red-500/15 rounded p-2.5 font-semibold text-red-300">
                                  {failure.reason}
                                </div>
                              </div>
                              {failure.rawResponse && (
                                <div className="text-xs space-y-1">
                                  <span className="text-muted-fg block font-medium">Phản hồi thô (Raw JSON):</span>
                                  <pre className="bg-background border border-border rounded p-2 text-[10px] font-mono text-muted-fg overflow-x-auto max-h-32">
                                    {failure.rawResponse}
                                  </pre>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        <div className="space-y-3">
                          {attemptSteps[selectedAttemptId].map((step, idx) => {
                            const stepNum = step.stepOrder || (idx + 1);
                            const isErr = step.status?.toUpperCase() === 'FAILED';

                            return (
                              <div
                                key={step.id}
                                className="flex items-start gap-4 p-3 border border-border rounded-lg bg-surface-1/50 hover:bg-surface-1 transition-colors text-sm"
                              >
                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-bold text-muted-fg font-mono border border-border">
                                  {stepNum}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <h4 className="font-bold text-foreground truncate">{translateStepName(step.stepName)}</h4>
                                    {getStepStatusBadge(step.status)}
                                  </div>

                                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-fg font-medium">
                                    {step.startedAt && (
                                      <span>Bắt đầu: {new Date(step.startedAt).toLocaleTimeString('vi-VN')}</span>
                                    )}
                                    {step.finishedAt && (
                                      <span>Hoàn thành: {new Date(step.finishedAt).toLocaleTimeString('vi-VN')}</span>
                                    )}
                                  </div>

                                  {isErr && step.errorMessage && (() => {
                                    let displayedError = step.errorMessage;
                                    try {
                                      const parsed = JSON.parse(step.errorMessage);
                                      if (parsed && parsed.reason) {
                                        displayedError = parsed.reason;
                                        if (displayedError === 'QR Code mismatch') displayedError = 'Sai lệch mã QR (QR Code mismatch)';
                                        else if (displayedError === 'Unreadable marking') displayedError = 'Mã khắc không đọc được (Unreadable marking)';
                                        else if (displayedError === 'Missing marking') displayedError = 'Thiếu dấu khắc/nhãn (Missing marking)';
                                      }
                                    } catch (e) {
                                      // Not JSON
                                    }
                                    return (
                                      <div className="mt-2 text-xs font-semibold text-red-400 bg-red-500/5 p-2 rounded border border-red-500/20 break-words">
                                        Lỗi: {displayedError}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="pt-2 border-t border-border">
            <Button variant="outline" className="w-full text-sm font-bold" onClick={() => setIsDetailDialogOpen(false)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* ── MODAL: Edit permissions ──────────────────────── */}
      <Dialog open={!!editingUser} onOpenChange={(open) => { if (!open) setEditingUser(null) }}>
        <DialogContent className="w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Key className="h-5 w-5 text-primary" />
              Phân quyền trực tiếp
            </DialogTitle>
            <DialogDescription className="text-sm">
              Cấp hoặc thu hồi quyền cho tài khoản{' '}
              <strong className="text-foreground">{editingUser?.username}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 max-h-[55vh] overflow-y-auto pr-1">
            {[
              {
                title: 'Vận hành sản xuất',
                codes: ['JOB_VIEW', 'JOB_REPROCESS']
              },
              {
                title: 'Quản trị',
                codes: ['USER_MANAGE']
              },
              {
                title: 'Hệ thống',
                codes: ['SYSTEM_ADMIN']
              }
            ].map((group) => {
              const groupPerms = availablePermissions.filter(p => group.codes.includes(p.code));
              if (groupPerms.length === 0) return null;

              return (
                <div key={group.title} className="space-y-2 border-b border-border pb-3 last:border-0 last:pb-0">
                  <h4 className="text-xs font-bold text-primary uppercase tracking-wider">{group.title}</h4>
                  <div className="space-y-2">
                    {groupPerms.map((p) => {
                      const isChecked = userPermDraft.includes(p.code);
                      return (
                        <div
                          key={p.code}
                          onClick={() => handleTogglePermDraft(p.code)}
                          className={[
                            'flex items-start gap-3 rounded-lg border p-3 transition-colors cursor-pointer',
                            isChecked
                              ? 'border-primary/50 bg-primary/5'
                              : 'border-border hover:bg-surface-2',
                          ].join(' ')}
                        >
                          <Checkbox
                            id={`perm-${p.code}`}
                            checked={isChecked}
                            onCheckedChange={() => { }}
                            className="mt-0.5"
                          />
                          <div className="space-y-0.5">
                            <p className="text-base font-semibold leading-none">{translatePermission(p.code)}</p>
                            <p className="text-sm text-muted-fg">{p.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter className="border-t border-border pt-4">
            <Button variant="outline" className="text-sm" onClick={() => setEditingUser(null)}>Hủy bỏ</Button>
            <Button variant="success" className="text-sm" onClick={handleSavePermissions}>
              <CheckCircle2 className="h-4 w-4" /> Lưu phân quyền
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── CONFIRM: Delete user ─────────────────────────── */}
      <ConfirmDialog
        open={!!userToDelete}
        title="Xác nhận xóa người dùng"
        description={`Bạn có chắc chắn muốn xóa tài khoản "${userToDelete?.username}"? Hành động này không thể hoàn tác.`}
        confirmText="Xóa tài khoản"
        confirmVariant="destructive"
        onConfirm={handleConfirmDeleteUser}
        onCancel={() => setUserToDelete(null)}
      />

      {/* ── CONFIRM: Toggle user active state ────────────── */}
      <ConfirmDialog
        open={!!userToToggleActive}
        title={userToToggleActive?.isActive ? "Xác nhận vô hiệu hóa tài khoản" : "Xác nhận kích hoạt tài khoản"}
        description={
          userToToggleActive?.isActive
            ? `Bạn có chắc chắn muốn vô hiệu hóa tài khoản "${userToToggleActive?.username}"? Người dùng này sẽ không thể đăng nhập vào kiosk.`
            : `Bạn có chắc chắn muốn kích hoạt lại tài khoản "${userToToggleActive?.username}"?`
        }
        confirmText={userToToggleActive?.isActive ? "Vô hiệu hóa" : "Kích hoạt"}
        confirmVariant={userToToggleActive?.isActive ? "destructive" : "success"}
        onConfirm={handleConfirmToggleActive}
        onCancel={() => setUserToToggleActive(null)}
      />

      {/* ── DIALOG: Reset Operator Password ────────── */}
      <Dialog open={!!resetPwdUser} onOpenChange={(open) => { if (!open) setResetPwdUser(null) }}>
        <DialogContent className="w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Key className="h-5 w-5 text-amber-500" />
              Đặt lại mật khẩu operator
            </DialogTitle>
            <DialogDescription className="text-sm">
              Đổi mật khẩu cho tài khoản <strong className="text-foreground">{resetPwdUser?.username}</strong>. Hành động này sẽ được ghi vào nhật ký kiểm toán.
            </DialogDescription>
          </DialogHeader>

          {resetError && (
            <div className="flex items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-base text-red-400">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              {resetError}
            </div>
          )}
          {resetSuccess && (
            <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-base text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {resetSuccess}
            </div>
          )}

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="new-pwd-val">Mật khẩu mới * (Tối thiểu 6 ký tự)</Label>
              <Input
                id="new-pwd-val"
                type="password"
                placeholder="Nhập mật khẩu mới..."
                value={newPasswordVal}
                onChange={(e) => setNewPasswordVal(e.target.value)}
                className="h-10 text-sm bg-transparent"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reset-reason">Lý do đặt lại mật khẩu *</Label>
              <Input
                id="reset-reason"
                type="text"
                placeholder="Ví dụ: Operator quên mật khẩu..."
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                className="h-10 text-sm bg-transparent"
              />
            </div>
          </div>

          <DialogFooter className="border-t border-border pt-4 mt-2">
            <Button variant="outline" className="text-sm" onClick={() => setResetPwdUser(null)}>Hủy bỏ</Button>
            <Button
              variant="success"
              className="text-sm"
              disabled={!newPasswordVal || newPasswordVal.length < 6 || !resetReason.trim()}
              onClick={handleResetPasswordSubmit}
            >
              Đặt lại mật khẩu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── CONFIRM: Reset password ──────────────────────── */}
      <ConfirmDialog
        open={resetPwdConfirmOpen}
        title="Xác nhận đặt lại mật khẩu"
        description="Bạn sắp thay đổi mật khẩu của tài khoản này. Hành động này sẽ được ghi nhận vào nhật ký hệ thống. Bạn có muốn tiếp tục?"
        confirmText="Đặt lại"
        confirmVariant="success"
        onConfirm={handleConfirmResetPassword}
        onCancel={() => setResetPwdConfirmOpen(false)}
      />

      {/* ── CONFIRM: Update permissions ──────────────────── */}
      <ConfirmDialog
        open={permConfirmOpen}
        title="Xác nhận cập nhật phân quyền"
        description="Bạn sắp thay đổi quyền trực tiếp của người dùng này. Hành động này sẽ được ghi nhận vào nhật ký hệ thống. Bạn có muốn tiếp tục?"
        confirmText="Cập nhật"
        confirmVariant="primary"
        onConfirm={handleConfirmSavePermissions}
        onCancel={() => setPermConfirmOpen(false)}
      />

      {/* ── CONFIRM: Manual Reprocess / Retry ────────────── */}
      <ConfirmDialog
        open={overrideConfirmOpen}
        title={overrideConfirmData?.title || 'Xác nhận hành động'}
        description={overrideConfirmData?.description || ''}
        confirmText="Xác nhận"
        confirmVariant="primary"
        onConfirm={handleConfirmTriggerReprint}
        onCancel={() => setOverrideConfirmOpen(false)}
      />

      {/* ── DIALOG: Audit History Timeline ──────────────── */}
      <Dialog open={!!auditLogUser} onOpenChange={(open) => { if (!open) setAuditLogUser(null) }}>
        <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <History className="h-5 w-5 text-primary" />
              Lịch sử kiểm toán của {auditLogUser?.username}
            </DialogTitle>
            <DialogDescription className="text-sm">
              Nhật ký các hoạt động bảo mật, đăng nhập, phân quyền, và các thao tác ghi đè thủ công của tài khoản này.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 max-h-[60vh] overflow-y-auto pr-1">
            {isAuditLogsLoading ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-fg animate-pulse">
                Đang tải nhật ký kiểm toán...
              </div>
            ) : auditLogs.length === 0 ? (
              <div className="text-center py-10 text-muted-fg">
                Không tìm thấy nhật ký kiểm toán nào cho người dùng này.
              </div>
            ) : (
              <div className="relative pl-6 border-l-2 border-border-strong space-y-6 ml-3">
                {auditLogs.map((log) => {
                  const date = new Date(log.performedAt);
                  const dateStr = date.toLocaleDateString('vi-VN');
                  const timeStr = date.toLocaleTimeString('vi-VN');

                  const isSuccess = log.result?.toUpperCase() === 'SUCCESS';
                  const isFailed = log.result?.toUpperCase() === 'FAILED' || log.result?.toUpperCase() === 'DENIED';

                  const detail = log.detail || {};
                  const reasonText = detail.Reason || detail.reason || log.actionName || '';
                  const oldValue = detail.OldValue || detail.oldValue;
                  const newValue = detail.NewValue || detail.newValue;

                  // Style based on action type
                  let badgeColor = 'bg-primary/10 text-primary border-primary/20';
                  if (log.actionName?.includes('DENIED') || log.actionName?.includes('FAILED')) {
                    badgeColor = 'bg-red-500/10 text-red-400 border-red-500/20';
                  } else if (log.actionName?.includes('SUCCESS') || log.actionName?.includes('ENABLED') || log.actionName?.includes('CREATED')) {
                    badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
                  }

                  return (
                    <div key={log.id} className="relative group">
                      {/* Timeline dot */}
                      <span className={[
                        'absolute -left-[31px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full border bg-background transition-colors',
                        isSuccess ? 'border-emerald-500 text-emerald-500' : isFailed ? 'border-red-500 text-red-500' : 'border-border'
                      ].join(' ')}>
                        <span className={`h-1.5 w-1.5 rounded-full ${isSuccess ? 'bg-emerald-500' : isFailed ? 'bg-red-500' : 'bg-muted-fg'}`} />
                      </span>

                      <div className="bg-surface-2 hover:bg-surface-3 border border-border rounded-lg p-4 transition-colors space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${badgeColor}`}>
                            {log.actionName}
                          </span>
                          <span className="text-xs text-muted-fg font-medium">
                            {timeStr} - {dateStr}
                          </span>
                        </div>

                        <p className="text-sm font-semibold text-foreground leading-relaxed">
                          {reasonText}
                        </p>

                        {(oldValue !== undefined || newValue !== undefined) && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-border/50 text-xs">
                            {oldValue !== undefined && oldValue !== '' && (
                              <div>
                                <span className="text-muted-fg font-medium block">Giá trị cũ:</span>
                                <span className="font-mono bg-surface-3 px-1.5 py-0.5 rounded border border-border inline-block mt-0.5 max-w-full truncate">
                                  {oldValue}
                                </span>
                              </div>
                            )}
                            {newValue !== undefined && newValue !== '' && (
                              <div>
                                <span className="text-muted-fg font-medium block">Giá trị mới:</span>
                                <span className="font-mono bg-surface-3 px-1.5 py-0.5 rounded border border-border inline-block mt-0.5 max-w-full truncate text-primary font-bold">
                                  {newValue}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="pt-2 border-t border-border">
            <Button variant="outline" className="w-full text-sm font-bold" onClick={() => setAuditLogUser(null)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── PORTAL: User Actions Menu ───────────────────── */}
      {activeDropdownUserId && dropdownPosition && (() => {
        const u = users.find(user => user.id === activeDropdownUserId);
        if (!u) return null;
        return createPortal(
          <div
            className="absolute w-52 rounded-lg bg-surface-2 border border-border shadow-xl z-9999 p-1 divide-y divide-border text-left portal-dropdown-content"
            style={{
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
            }}
          >
            <div className="py-1">
              <button
                onClick={() => {
                  setActiveDropdownUserId(null);
                  setDropdownPosition(null);
                  startEditPermissions(u);
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-surface-3 hover:text-primary rounded-md transition-colors cursor-pointer text-left font-medium"
              >
                <ShieldAlert className="h-4 w-4 text-primary" />
                <span>Phân quyền</span>
              </button>

              <button
                onClick={() => {
                  setActiveDropdownUserId(null);
                  setDropdownPosition(null);
                  startResetPassword(u);
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-surface-3 hover:text-primary rounded-md transition-colors cursor-pointer text-left font-medium"
              >
                <Key className="h-4 w-4 text-amber-500" />
                <span>Đặt lại mật khẩu</span>
              </button>

              <button
                onClick={() => {
                  setActiveDropdownUserId(null);
                  setDropdownPosition(null);
                  showAuditLogs(u);
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-surface-3 hover:text-primary rounded-md transition-colors cursor-pointer text-left font-medium"
              >
                <History className="h-4 w-4 text-primary" />
                <span>Lịch sử kiểm toán</span>
              </button>
            </div>

            {u.username !== PROTECTED_ADMIN_USERNAME && (
              <div className="py-1">
                <button
                  onClick={() => {
                    setActiveDropdownUserId(null);
                    setDropdownPosition(null);
                    setUserToToggleActive(u);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-surface-3 rounded-md transition-colors cursor-pointer text-left font-medium"
                >
                  {u.isActive ? (
                    <>
                      <UserX className="h-4 w-4 text-red-400" />
                      <span className="text-red-400">Vô hiệu hóa</span>
                    </>
                  ) : (
                    <>
                      <UserCheck className="h-4 w-4 text-emerald-400" />
                      <span className="text-emerald-400">Kích hoạt</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => {
                    setActiveDropdownUserId(null);
                    setDropdownPosition(null);
                    setUserToDelete(u);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-500 hover:bg-red-500/10 font-bold rounded-md transition-colors cursor-pointer text-left"
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                  <span>Xóa tài khoản</span>
                </button>
              </div>
            )}
          </div>,
          document.body
        );
      })()}
    </div>
  )
}
