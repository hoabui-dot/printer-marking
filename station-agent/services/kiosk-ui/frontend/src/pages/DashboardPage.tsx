import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useDashboard, ProductionRecord } from '@/hooks/useDashboard'
import { useProductionRecords } from '@/hooks/useProductionRecords'
import { rbacApi, jobsApi, commandsApi } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { PROTECTED_ADMIN_USERNAME, CREATABLE_ROLES } from '@/constants/roles'
import { translatePermission, translateRole, translateJobType } from '@/lib/utils'

// Icons
import {
  Users, LayoutDashboard, Key, Trash2, Plus,
  CheckCircle2, ShieldAlert, LogOut, UserCheck, Wifi, WifiOff,
  Flame, Cpu, Printer as PrinterIcon, Zap, Camera, Clock,
  Filter, RefreshCw, History, Database,
  Shield, User, UserX, MoreVertical
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

type KioskTab = 'dashboard' | 'history' | 'connectivity' | 'rbac'

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
  if (s === 'COMPLETED') return <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs">Hoàn thành</Badge>;
  if (s === 'FAILED') return <Badge className="bg-red-500/10 text-red-400 border border-red-500/30 text-xs">Thất bại</Badge>;
  if (s === 'PROCESSING') return <Badge className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 text-xs animate-pulse">Đang chạy</Badge>;
  if (s === 'SKIPPED') return <Badge className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 text-xs">Bỏ qua</Badge>;
  return <Badge className="bg-gray-500/10 text-gray-400 border border-gray-500/30 text-xs">Chờ</Badge>;
};

export default function DashboardPage() {
  const stationId = 'STATION-01'
  const navigate = useNavigate()
  const { user: currentUser, logout } = useAuth()
  const { isConnected, production, devices, todayRecords } = useDashboard(stationId)
  const gatewayDevice = devices.find(d => d.deviceId === 'gateway-01')
  const isGatewayOnline = gatewayDevice?.isOnline ?? false
  const { historyData, loading: loadingHistory, error: historyError, fetchHistory } = useProductionRecords()

  const hasActiveJob = production &&
    production.jobStatus !== 'COMPLETED' &&
    production.jobStatus !== 'FAILED'

  const [tab, setTab] = useState<KioskTab>('dashboard')

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
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false)
  const [selectedDetailRecord, setSelectedDetailRecord] = useState<ProductionRecord | null>(null)
  const [detailAttempts, setDetailAttempts] = useState<any[]>([])
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null)
  const [attemptSteps, setAttemptSteps] = useState<Record<string, any[]>>({})
  const [loadingDetail, setLoadingDetail] = useState(false)

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

  // Fetch attempts and history for history detail modal
  useEffect(() => {
    if (selectedDetailRecord) {
      setLoadingDetail(true)
      setSelectedAttemptId(null)
      setAttemptSteps({})
      
      jobsApi.getAttempts(selectedDetailRecord.jobId)
        .then(attemptsRes => {
          setDetailAttempts(attemptsRes.data)
          if (attemptsRes.data && attemptsRes.data.length > 0) {
            const latest = [...attemptsRes.data].sort((a: any, b: any) => b.attemptNo - a.attemptNo)[0];
            setSelectedAttemptId(latest.id);
          }
        })
        .catch(err => {
          console.error("Failed to load job details:", err)
        })
        .finally(() => {
          setLoadingDetail(false)
        })
    }
  }, [selectedDetailRecord])

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
    { key: 'history' as KioskTab, label: 'Lịch sử sản xuất', icon: History, show: canViewJobs },
    { key: 'connectivity' as KioskTab, label: 'Hệ thống & Kết nối', icon: Cpu, show: true },
    { key: 'rbac' as KioskTab, label: 'Quản lý phân quyền', icon: Users, show: isSuperAdmin },
  ]

  /* ═══════════════════════════════════════════════════════ */
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">

      {/* ── TOP HEADER BAR ──────────────────────────────── */}
      <header className="sticky top-0 z-40 w-full border-b border-border bg-card">
        <div className="flex h-16 items-center justify-between gap-4 px-6 lg:px-8 max-w-7xl mx-auto w-full">
          {/* Brand */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-700 to-indigo-500">
              <Flame className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-base leading-tight truncate">ND Station Kiosk</p>
              <p className="text-sm text-muted-fg leading-tight">{stationId}</p>
            </div>
          </div>

          {/* Center: current user */}
          {currentUser && (
            <div className="hidden md:flex items-center gap-2 text-base text-muted-fg">
              <UserCheck className="h-4 w-4 shrink-0" />
              <span>
                <span className="font-semibold text-foreground">{currentUser.username}</span>
                <span className="ml-1.5 opacity-60">— {currentUser.roles?.map(translateRole).join(', ')}</span>
              </span>
            </div>
          )}

          {/* Right: status + logout */}
          <div className="flex items-center gap-3 shrink-0">
            <Badge variant={isConnected ? 'connected' : 'disconnected'} className="gap-1.5 hidden sm:flex text-sm">
              {isConnected
                ? <><Wifi className="h-3 w-3" /> SignalR</>
                : <><WifiOff className="h-3 w-3" /> Offline</>
              }
            </Badge>
            <Button variant="ghost" size="sm" onClick={handleLogout}
              className="gap-1.5 text-muted-fg hover:text-red-400 hover:bg-red-500/10 text-base"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </Button>
          </div>
        </div>
      </header>

      {/* ── SUB-NAV TABS ────────────────────────────────── */}
      <nav className="w-full border-b border-border bg-card">
        <div className="flex gap-1 px-6 lg:px-8 pt-4 max-w-7xl mx-auto w-full overflow-x-auto">
          {tabs.filter((t) => t.show).map(({ key, label, icon: Icon }) => {
            const active = tab === key
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={[
                  'flex items-center gap-2 px-4 py-2.5 text-base font-semibold rounded-t-lg border-b-2 transition-all whitespace-nowrap',
                  active
                    ? 'border-primary text-indigo-500 bg-indigo-500/5'
                    : 'border-transparent text-muted-fg hover:text-foreground hover:bg-surface-2',
                ].join(' ')}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            )
          })}
        </div>
      </nav>

      {/* ── MAIN CONTENT ────────────────────────────────── */}
      <main className="flex-1 overflow-auto p-6 lg:p-8">

        {/* ════ TAB: DASHBOARD ════════════════════════════ */}
        {tab === 'dashboard' && (
          <div className="space-y-6 max-w-7xl mx-auto">

            {/* Big Wrapper Card: THÔNG TIN LỆNH SẢN XUẤT HIỆN TẠI (FROM MES) */}
            <Card className="border border-border bg-card shadow-sm">
              <CardHeader className="py-4 px-6 border-b border-border bg-surface-2">
                <CardTitle className="text-lg font-extrabold tracking-wider text-indigo-500 uppercase flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  THÔNG TIN LỆNH SẢN XUẤT HIỆN TẠI (FROM MES)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {/* Grid of Production Status Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                  {/* Card 1: Active Work Order */}
                  <Card className="relative overflow-hidden bg-card border-border shadow-sm">
                    <CardHeader className="pb-2">
                      <CardDescription className="text-sm uppercase tracking-wider font-semibold">Lệnh sản xuất</CardDescription>
                      <CardTitle className="text-2xl font-bold font-mono tracking-tight text-foreground">
                        {hasActiveJob ? production.workOrderNo : 'Không có lệnh'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <span className="text-sm text-muted-fg">Lệnh sản xuất hiện tại tại trạm</span>
                    </CardContent>
                  </Card>

                  {/* Card 2: Product Code */}
                  <Card className="relative overflow-hidden bg-card border-border shadow-sm">
                    <CardHeader className="pb-2">
                      <CardDescription className="text-sm uppercase tracking-wider font-semibold">Mã sản phẩm</CardDescription>
                      <CardTitle className="text-2xl font-bold font-mono tracking-tight text-foreground">
                        {hasActiveJob ? production.productCode : '—'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <span className="text-sm text-muted-fg">Mã SKU của sản phẩm đang gia công</span>
                    </CardContent>
                  </Card>

                  {/* Card 3: Product Serial */}
                  <Card className="relative overflow-hidden bg-card border-border shadow-sm">
                    <CardHeader className="pb-2">
                      <CardDescription className="text-sm uppercase tracking-wider font-semibold">Số Serial / UID</CardDescription>
                      <CardTitle className="text-2xl font-bold font-mono tracking-tight text-foreground">
                        {hasActiveJob && production.productSerial ? production.productSerial : '—'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <span className="text-sm text-muted-fg">Mã định danh duy nhất của sản phẩm</span>
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>

            {/* Latest Production Mini-Table */}
            <Card className="border border-border bg-card shadow-sm">
              <CardHeader className="py-4 px-6 border-b border-border">
                <CardTitle className="text-base font-bold uppercase tracking-wider flex items-center gap-2">
                  <Clock className="h-4 w-4 text-indigo-500" />
                  Sản xuất gần đây (5 bản ghi mới nhất)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="w-full overflow-x-auto">
                  <TableEl>
                  <TableHeader className="bg-surface-2">
                    <TableRow>
                      <TableHead className="pl-6 text-sm">Thời gian cập nhật</TableHead>
                      <TableHead className="text-sm">Lệnh sản xuất</TableHead>
                      <TableHead className="text-sm">Mã sản phẩm</TableHead>
                      <TableHead className="text-sm">Số Serial / UID</TableHead>
                      <TableHead className="text-sm">Trạng thái</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {todayRecords.slice(0, 5).map((record) => (
                      <TableRow
                        key={record.id}
                        className="hover:bg-surface-1 cursor-pointer transition-colors"
                        onClick={() => setSelectedRecord(record)}
                      >
                        <TableCell className="pl-6 font-mono text-sm">
                          {new Date(record.updatedAt).toLocaleTimeString('vi-VN')}
                        </TableCell>
                        <TableCell className="font-bold text-sm">{record.jobNo}</TableCell>
                        <TableCell className="text-muted-fg text-sm">{record.productCode}</TableCell>
                        <TableCell className="font-mono text-sm text-muted-fg">{record.productSerial || '—'}</TableCell>
                        <TableCell>
                          <StatusBadge status={record.currentStatus} jobType={record.jobType} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {todayRecords.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-fg text-base">
                          Không có sản phẩm nào được xử lý hôm nay.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </TableEl>
              </div>
            </CardContent>
            </Card>

            {/* IN/KHẮC LẠI TEM Gradient Button */}
            <div className="flex justify-end pt-2">
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
                Xử lý lại sản phẩm
              </Button>
            </div>

          </div>
        )}


        {/* ════ TAB: HISTORY ═══════════════════════════════ */}
        {tab === 'history' && (
          <div className="space-y-6 max-w-7xl mx-auto">
            {/* Filter Panel */}
            <Card className="border border-border bg-card">
              <CardHeader className="py-4 px-6 border-b border-border">
                <CardTitle className="text-base font-bold uppercase tracking-wider flex items-center gap-2">
                  <Filter className="h-4 w-4 text-indigo-500" />
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
                    <Database className="h-4 w-4 text-indigo-500" />
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
                      <TableHead className="text-sm">Số Serial / UID</TableHead>
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
            <Card className="border-2 border-indigo-500/20 bg-indigo-500/5 overflow-hidden">
              <div className="p-6 flex flex-col md:flex-row items-center justify-between gap-6">
                <div>
                  <h3 className="font-extrabold text-base text-foreground flex items-center gap-2">
                    <Flame className="h-5 w-5 text-indigo-500" />
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
                  <Cpu className="h-4 w-4 text-indigo-500" />
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
                      <div key={device.deviceId} className="border border-border bg-surface-1 rounded-xl p-4 flex flex-col justify-between h-36 hover:border-indigo-500/20 transition-all duration-300">
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

        {/* ════ TAB: RBAC ══════════════════════════════════ */}
        {tab === 'rbac' && isSuperAdmin && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-7xl mx-auto">

            {/* Users list — spans 2 cols on xl */}
            <Card className="xl:col-span-2 overflow-hidden">
              <CardHeader className="border-b border-border px-6 py-4">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Users className="h-5 w-5 text-indigo-500" />
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
                  <Plus className="h-5 w-5 text-indigo-500" />
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

      {/* ── DIALOG: Record Details ───────────────────────── */}
      <Dialog open={!!selectedRecord} onOpenChange={(open) => { if (!open) setSelectedRecord(null) }}>
        <DialogContent className="w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-indigo-500 font-bold text-xl">
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
                      <span className="font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/30">
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
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 bg-transparent cursor-pointer"
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
            <DialogTitle className="flex items-center gap-2 text-indigo-500 font-bold text-xl">
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
                <span className="text-muted-fg block text-xs uppercase font-semibold">Số Serial / UID</span>
                <span className="font-mono text-foreground text-base">{selectedDetailRecord.productSerial || '—'}</span>
              </div>
              <div>
                <span className="text-muted-fg block text-xs uppercase font-semibold">Trạng thái hiện tại</span>
                <div className="mt-0.5">
                  <StatusBadge status={selectedDetailRecord.currentStatus} jobType={selectedDetailRecord.jobType} />
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 py-4 md:overflow-hidden flex-1 min-h-0">
            {/* Left Panel: Attempts List (Col span 4) */}
            <div className="md:col-span-4 flex flex-col md:overflow-hidden border border-border rounded-lg bg-surface-2/30 max-h-[250px] md:max-h-none">
              <div className="p-3 border-b border-border bg-surface-2 font-bold text-sm uppercase tracking-wider text-muted-fg flex items-center justify-between">
                <span>Danh sách lần chạy</span>
                <Badge variant="outline" className="bg-background">{detailAttempts.length}</Badge>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {loadingDetail ? (
                  <div className="text-center py-10 text-muted-fg text-sm animate-pulse">Đang tải danh sách...</div>
                ) : detailAttempts.length === 0 ? (
                  <div className="text-center py-10 text-muted-fg text-sm">Không có dữ liệu lần chạy.</div>
                ) : (
                  [...detailAttempts].sort((a, b) => b.attemptNo - a.attemptNo).map((attempt) => {
                    const isSelected = selectedAttemptId === attempt.id;
                    const triggerText = translateTriggerType(attempt.triggerType);
                    const isSuccess = attempt.resultStatus?.toUpperCase() === 'COMPLETED';
                    const isFailed = attempt.resultStatus?.toUpperCase() === 'FAILED';
                    
                    return (
                      <div
                        key={attempt.id}
                        onClick={() => setSelectedAttemptId(attempt.id)}
                        className={[
                          'p-3 rounded-lg cursor-pointer border transition-all space-y-2',
                          isSelected
                            ? 'bg-indigo-500/10 border-indigo-500/50 text-foreground ring-1 ring-indigo-500/30'
                            : 'border-transparent bg-surface-1 hover:bg-surface-2 hover:border-border text-muted-fg hover:text-foreground'
                        ].join(' ')}
                      >
                        <div className="flex justify-between items-center font-bold">
                          <span className={isSelected ? 'text-indigo-400 text-sm' : 'text-foreground text-sm'}>
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
                            'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse'
                          ].join(' ')}>
                            {attempt.resultStatus === 'COMPLETED' ? 'OK' :
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

            {/* Right Panel: Attempt Steps (Col span 8) */}
            <div className="md:col-span-8 flex flex-col md:overflow-hidden min-h-0">
              
              {/* Attempt Steps Section */}
              <div className="flex-1 flex flex-col border border-border rounded-lg bg-surface-2/30 md:overflow-hidden min-h-[300px]">
                <div className="p-3 border-b border-border bg-surface-2 font-bold text-sm uppercase tracking-wider text-muted-fg flex items-center justify-between">
                  <span>Tiến trình từng bước</span>
                  {selectedAttemptId && (
                    <span className="font-mono text-xs text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
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
