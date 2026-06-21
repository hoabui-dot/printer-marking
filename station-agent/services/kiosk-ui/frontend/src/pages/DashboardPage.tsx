import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDashboard } from '@/hooks/useDashboard'
import { rbacApi } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { PROTECTED_ADMIN_USERNAME, CREATABLE_ROLES } from '@/constants/roles'
import { translatePermission, translateRole } from '@/lib/utils'

// Icons
import {
  Activity, Users, LayoutDashboard, Key, Trash2, Plus,
  CheckCircle2, ShieldAlert, LogOut, UserCheck, Wifi, WifiOff,
  Flame, Cpu, Printer as PrinterIcon, Zap, Camera, Clock, Info,
  AlertCircle, Play, CheckCircle
} from 'lucide-react'

// Common Components
import { StatusBadge } from '@/components/StatusBadge'
import { PermissionBadge } from '@/components/PermissionBadge'
import { ConfirmDialog } from '@/components/ConfirmDialog'

// UI primitives
import { Button }   from '@/components/ui/button'
import { Input }    from '@/components/ui/input'
import { Label }    from '@/components/ui/label'
import { Badge }    from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type KioskTab = 'dashboard' | 'rbac'

export default function DashboardPage() {
  const stationId = 'STATION-01'
  const navigate  = useNavigate()
  const { user: currentUser, logout } = useAuth()
  const { isConnected, production, activities, devices } = useDashboard(stationId)

  const [tab,                  setTab]                 = useState<KioskTab>('dashboard')
  const [users,                setUsers]               = useState<any[]>([])
  const [availablePermissions, setAvailablePermissions] = useState<any[]>([])
  const [editingUser,          setEditingUser]         = useState<any | null>(null)
  const [userPermDraft,        setUserPermDraft]       = useState<string[]>([])
  const [userToDelete,         setUserToDelete]        = useState<any | null>(null)
  const [newUsername,          setNewUsername]         = useState('')
  const [newFullName,          setNewFullName]         = useState('')
  const [newPassword,          setNewPassword]         = useState('')
  const [newRole,              setNewRole]             = useState('MEMBER')
  const [rbacError,            setRbacError]           = useState('')
  const [rbacSuccess,          setRbacSuccess]         = useState('')

  const isSuperAdmin =
    currentUser?.roles?.includes('SUPER_ADMIN') ||
    currentUser?.permissions?.includes('SYSTEM_ADMIN')

  const fetchRbacData = () => {
    if (!isSuperAdmin) return
    rbacApi.getUsers().then((res) => setUsers(res.data)).catch(console.error)
    rbacApi.getPermissions().then((res) => setAvailablePermissions(res.data)).catch(console.error)
  }

  useEffect(() => { if (tab === 'rbac') fetchRbacData() }, [tab, currentUser])

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

  const handleSavePermissions = async () => {
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

  /* ── tab config ───────────────────────────────────────── */
  const tabs = [
    { key: 'dashboard' as KioskTab, label: 'Bảng điều khiển', icon: LayoutDashboard, show: true },
    { key: 'rbac'      as KioskTab, label: 'Quản lý phân quyền', icon: Users, show: isSuperAdmin },
  ]

  /* ═══════════════════════════════════════════════════════ */
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">

      {/* ── TOP HEADER BAR ──────────────────────────────── */}
      <header className="sticky top-0 z-40 w-full border-b border-border bg-card">
        <div className="flex h-16 items-center justify-between gap-4 px-6 lg:px-8 max-w-7xl mx-auto w-full">
          {/* Brand */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-dark to-brand-light">
              <Flame className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm leading-tight truncate">ND Station Kiosk</p>
              <p className="text-xs text-muted-fg leading-tight">{stationId}</p>
            </div>
          </div>

          {/* Center: current user */}
          {currentUser && (
            <div className="hidden md:flex items-center gap-2 text-sm text-muted-fg">
              <UserCheck className="h-4 w-4 shrink-0" />
              <span>
                <span className="font-semibold text-foreground">{currentUser.username}</span>
                <span className="ml-1.5 opacity-60">— {currentUser.roles?.map(translateRole).join(', ')}</span>
              </span>
            </div>
          )}

          {/* Right: status + logout */}
          <div className="flex items-center gap-3 shrink-0">
            <Badge variant={isConnected ? 'connected' : 'disconnected'} className="gap-1.5 hidden sm:flex">
              {isConnected
                ? <><Wifi className="h-3 w-3" /> SignalR</>
                : <><WifiOff className="h-3 w-3" /> Offline</>
              }
            </Badge>
            <Button variant="ghost" size="sm" onClick={handleLogout}
              className="gap-1.5 text-muted-fg hover:text-red-400 hover:bg-red-500/10"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </Button>
          </div>
        </div>
      </header>

      {/* ── SUB-NAV TABS ────────────────────────────────── */}
      <nav className="w-full border-b border-border bg-card">
        <div className="flex gap-1 px-6 lg:px-8 pt-4 max-w-7xl mx-auto w-full">
          {tabs.filter((t) => t.show).map(({ key, label, icon: Icon }) => {
            const active = tab === key
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={[
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 transition-all',
                  active
                    ? 'border-primary text-brand-light bg-brand/8'
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

            {/* Top Grid of Production Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              
              {/* Card 1: Active Work Order */}
              <Card className="relative overflow-hidden bg-card border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs uppercase tracking-wider font-semibold">Lệnh sản xuất</CardDescription>
                  <CardTitle className="text-xl font-bold font-mono tracking-tight text-foreground">
                    {production?.workOrderNo || 'Không có lệnh'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-xs text-muted-fg">Lệnh sản xuất hiện tại tại trạm</span>
                </CardContent>
              </Card>

              {/* Card 2: Product Code */}
              <Card className="relative overflow-hidden bg-card border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs uppercase tracking-wider font-semibold">Mã sản phẩm</CardDescription>
                  <CardTitle className="text-xl font-bold font-mono tracking-tight text-foreground">
                    {production?.productCode || '—'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-xs text-muted-fg">Mã SKU của sản phẩm đang gia công</span>
                </CardContent>
              </Card>

              {/* Card 3: Product Serial */}
              <Card className="relative overflow-hidden bg-card border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs uppercase tracking-wider font-semibold">Số Serial / UID</CardDescription>
                  <CardTitle className="text-xl font-bold font-mono tracking-tight text-foreground">
                    {production?.productSerial || '—'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-xs text-muted-fg">Mã định danh duy nhất của sản phẩm</span>
                </CardContent>
              </Card>

              {/* Card 4: Job Status */}
              <Card className={`relative overflow-hidden border shadow-sm transition-all duration-300 ${
                production?.jobStatus === 'QUEUED' ? 'border-amber-500/20 bg-amber-500/5' :
                production?.jobStatus === 'PROCESSING' ? 'border-blue-500/20 bg-blue-500/5' :
                production?.jobStatus === 'COMPLETED' ? 'border-emerald-500/20 bg-emerald-500/5' :
                production?.jobStatus === 'FAILED' ? 'border-red-500/20 bg-red-500/5' :
                'border-border bg-card'
              }`}>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs uppercase tracking-wider font-semibold">Trạng thái công việc</CardDescription>
                  <CardTitle className="text-xl font-extrabold tracking-wide flex items-center gap-2">
                    <StatusBadge status={production?.jobStatus || 'IDLE'} />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-xs text-muted-fg">
                    {production?.updatedAt 
                      ? `Cập nhật lúc: ${new Date(production.updatedAt).toLocaleTimeString('vi-VN')}`
                      : 'Đang đợi lệnh sản xuất'}
                  </span>
                </CardContent>
              </Card>

            </div>

            {/* Split layout: Device Connectivity vs Activity Feed */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Left Column: Device Health Status */}
              <Card className="lg:col-span-1 border border-border bg-card">
                <CardHeader className="border-b border-border bg-gradient-to-r from-surface-2 to-card py-4 px-6">
                  <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-brand-light" />
                    Trạng thái kết nối thiết bị
                  </CardTitle>
                  <CardDescription className="text-xs">Theo dõi kết nối phần cứng của trạm</CardDescription>
                </CardHeader>
                <CardContent className="p-6 divide-y divide-border">
                  {devices.map((device) => {
                    const DeviceIcon = 
                      device.deviceType === 'PLC' ? Cpu :
                      device.deviceType === 'PRINTER' ? PrinterIcon :
                      device.deviceType === 'LASER' ? Zap :
                      device.deviceType === 'VISION_CAMERA' ? Camera :
                      Cpu;

                    return (
                      <div key={device.deviceId} className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-3">
                          <div className={`p-2.5 rounded-lg border ${
                            device.isOnline ? 'border-emerald-500/10 bg-emerald-500/5 text-emerald-400' : 'border-red-500/10 bg-red-500/5 text-red-400'
                          }`}>
                            <DeviceIcon className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="font-bold text-sm text-foreground">{device.deviceId.toUpperCase()}</p>
                            <p className="text-xs text-muted-fg mt-0.5">{device.deviceType}</p>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold ${
                            device.isOnline ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${device.isOnline ? 'bg-emerald-400' : 'bg-red-400'}`}></span>
                            {device.isOnline ? 'Online' : 'Offline'}
                          </span>
                          <span className="text-[10px] text-muted-fg">
                            {new Date(device.lastSeenAt).toLocaleTimeString('vi-VN')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {devices.length === 0 && (
                    <p className="text-sm text-muted-fg text-center py-6">Không có thông tin thiết bị.</p>
                  )}
                </CardContent>
              </Card>

              {/* Right Column: Activity Feed */}
              <Card className="lg:col-span-2 border border-border bg-card">
                <CardHeader className="border-b border-border bg-gradient-to-r from-surface-2 to-card py-4 px-6">
                  <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                    <Activity className="h-4 w-4 text-brand-light" />
                    Lịch sử hoạt động thời gian thực
                  </CardTitle>
                  <CardDescription className="text-xs">Theo dõi các sự kiện sản xuất mới nhất (Tối đa 10)</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-[380px] overflow-y-auto divide-y divide-border">
                    {activities.map((act) => {
                      const ActIcon = 
                        act.eventType === 'MqttMessageReceived' ? Flame :
                        act.eventType === 'JobCreated' ? Play :
                        act.eventType === 'JobProcessing' ? Activity :
                        act.eventType === 'JobCompleted' ? CheckCircle :
                        act.eventType === 'JobFailed' ? AlertCircle :
                        Info;

                      const actColorClass = 
                        act.eventType === 'JobCompleted' ? 'text-emerald-400' :
                        act.eventType === 'JobFailed' ? 'text-red-400' :
                        act.eventType === 'JobProcessing' ? 'text-blue-400' :
                        act.eventType === 'JobCreated' ? 'text-amber-400' :
                        'text-muted-fg';

                      return (
                        <div key={act.id} className="flex gap-4 p-4 hover:bg-surface-1 transition-colors duration-200">
                          <div className={`p-2 rounded-full border border-border h-fit ${actColorClass} bg-card`}>
                            <ActIcon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 space-y-1 min-w-0">
                            <div className="flex justify-between items-start gap-2">
                              <p className="text-sm font-bold text-foreground leading-none">
                                {act.eventType === 'MqttMessageReceived' ? 'Yêu cầu MQTT nhận' :
                                 act.eventType === 'JobCreated' ? 'Khởi tạo công việc' :
                                 act.eventType === 'JobProcessing' ? 'Đang gia công' :
                                 act.eventType === 'JobCompleted' ? 'Hoàn thành' :
                                 act.eventType === 'JobFailed' ? 'Lỗi sản xuất' :
                                 act.eventType}
                              </p>
                              <span className="text-[10px] text-muted-fg shrink-0 flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {new Date(act.occurredAt).toLocaleTimeString('vi-VN')}
                              </span>
                            </div>
                            <p className="text-xs text-muted-fg font-medium">{act.message}</p>
                            
                            {/* Inner Details */}
                            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[10px] font-mono text-muted-fg">
                              {act.jobNo && <span>Job: <strong className="text-foreground">{act.jobNo}</strong></span>}
                              {act.productCode && <span>Product: <strong className="text-foreground">{act.productCode}</strong></span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {activities.length === 0 && (
                      <div className="text-center py-20 text-muted-fg">
                        <Activity className="h-10 w-10 mx-auto mb-3 opacity-20" />
                        Không có hoạt động nào được ghi nhận.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

            </div>

          </div>
        )}

        {/* ════ TAB: RBAC ══════════════════════════════════ */}
        {tab === 'rbac' && isSuperAdmin && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-7xl mx-auto">

            {/* Users list — spans 2 cols on xl */}
            <Card className="xl:col-span-2 overflow-hidden">
              <CardHeader className="border-b border-border px-6 py-4">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-brand-light" />
                  Danh sách người dùng Kiosk
                </CardTitle>
                <CardDescription>Quản lý vai trò và quyền hạn của người vận hành trạm</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-4">

                {/* Alerts */}
                {rbacSuccess && (
                  <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-400">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    {rbacSuccess}
                  </div>
                )}
                {rbacError && (
                  <div className="flex items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    {rbacError}
                  </div>
                )}

                {/* Table */}
                <div className="rounded-lg border border-border overflow-hidden">
                  <Table>
                    <TableHeader className="bg-surface-2">
                      <TableRow>
                        <TableHead className="pl-4">Tên đăng nhập</TableHead>
                        <TableHead>Họ và tên</TableHead>
                        <TableHead>Vai trò</TableHead>
                        <TableHead>Quyền hạn</TableHead>
                        <TableHead className="pr-4 text-right">Thao tác</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="pl-4 font-bold">{u.username}</TableCell>
                          <TableCell className="text-muted-fg">{u.fullName}</TableCell>
                          <TableCell>
                            <Badge variant={u.roles.includes('SUPER_ADMIN') ? 'admin' : 'member'}>
                              {u.roles.map(translateRole).join(', ')}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1 max-w-[220px]">
                              {u.roles.includes('SUPER_ADMIN') ? (
                                <span className="text-xs font-semibold text-brand-light">
                                  Tất cả (Mặc định)
                                </span>
                              ) : (
                                <>
                                  {u.directPermissions.length === 0 && (
                                    <span className="text-xs italic text-subtle-fg">Xem công việc (Mặc định)</span>
                                  )}
                                  {u.directPermissions.map((p: string) => (
                                    <PermissionBadge key={p} permission={p} />
                                  ))}
                                </>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="pr-4 text-right">
                            <div className="flex gap-2 justify-end">
                              {!u.roles.includes('SUPER_ADMIN') && (
                                <Button variant="outline" size="sm" onClick={() => startEditPermissions(u)}
                                  className="h-8 gap-1 text-xs"
                                >
                                  <Key className="h-3 w-3" /> Phân quyền
                                </Button>
                              )}
                              {u.username !== PROTECTED_ADMIN_USERNAME && (
                                <Button variant="destructive" size="sm" onClick={() => setUserToDelete(u)}
                                  className="h-8 gap-1 text-xs"
                                >
                                  <Trash2 className="h-3 w-3" /> Xóa
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Create user form */}
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-border px-6 py-4">
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5 text-brand-light" />
                  Đăng ký người dùng mới
                </CardTitle>
                <CardDescription>Tạo tài khoản cho nhân viên vận hành trạm</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <form onSubmit={handleCreateUser} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="newUsername">Tên đăng nhập</Label>
                    <Input id="newUsername" type="text" required placeholder="Ví dụ: operator_nam"
                      value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="newFullName">Họ và tên</Label>
                    <Input id="newFullName" type="text" required placeholder="Ví dụ: Nguyễn Văn Nam"
                      value={newFullName} onChange={(e) => setNewFullName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="newPassword">Mật khẩu</Label>
                    <Input id="newPassword" type="password" required placeholder="Tối thiểu 6 ký tự"
                      value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Vai trò hệ thống</Label>
                    <Select value={newRole} onValueChange={setNewRole}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Chọn vai trò" />
                      </SelectTrigger>
                      <SelectContent>
                        {CREATABLE_ROLES.map((role) => (
                          <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" className="w-full mt-2">
                    <Plus className="h-4 w-4" /> Tạo người dùng
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* ── MODAL: Edit permissions ──────────────────────── */}
      <Dialog open={!!editingUser} onOpenChange={(open) => { if (!open) setEditingUser(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-brand-light" />
              Phân quyền trực tiếp
            </DialogTitle>
            <DialogDescription>
              Cấp hoặc thu hồi quyền cho tài khoản{' '}
              <strong className="text-foreground">{editingUser?.username}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2 max-h-[55vh] overflow-y-auto pr-1">
            {availablePermissions.map((p) => {
              const isChecked  = userPermDraft.includes(p.code)
              const isViewOnly = p.code === 'JOB_VIEW'
              return (
                <div
                  key={p.code}
                  onClick={() => { if (!isViewOnly) handleTogglePermDraft(p.code) }}
                  className={[
                    'flex items-start gap-3 rounded-lg border p-3 transition-colors cursor-pointer',
                    isChecked
                      ? 'border-primary/50 bg-brand/8'
                      : 'border-border hover:bg-surface-2',
                    isViewOnly ? 'opacity-60 cursor-default' : '',
                  ].join(' ')}
                >
                  <Checkbox
                    id={`perm-${p.code}`}
                    checked={isChecked}
                    onCheckedChange={() => {}}
                    disabled={isViewOnly}
                    className="mt-0.5"
                  />
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold leading-none">{translatePermission(p.code)}</p>
                    <p className="text-xs text-muted-fg">{p.description}</p>
                  </div>
                </div>
              )
            })}
          </div>

          <DialogFooter className="border-t border-border pt-4">
            <Button variant="outline" onClick={() => setEditingUser(null)}>Hủy bỏ</Button>
            <Button variant="success" onClick={handleSavePermissions}>
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
        onConfirm={handleConfirmDeleteUser}
        onCancel={() => setUserToDelete(null)}
      />
    </div>
  )
}
