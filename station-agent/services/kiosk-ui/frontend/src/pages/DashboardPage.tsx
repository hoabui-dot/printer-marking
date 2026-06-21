import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDashboard } from '@/hooks/useDashboard'
import { jobsApi, rbacApi } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { PROTECTED_ADMIN_USERNAME, CREATABLE_ROLES } from '@/constants/roles'
import { translateJobType, translatePermission, translateRole } from '@/lib/utils'

// Icons
import {
  Activity, Users, LayoutDashboard, Key, Trash2, Plus,
  CheckCircle2, ShieldAlert, LogOut, UserCheck, Wifi, WifiOff,
  Flame,
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
  const { isConnected, latestJobStatus } = useDashboard(stationId)

  const [jobs,                 setJobs]                = useState<any[]>([])
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

  /* ── load jobs ────────────────────────────────────────── */
  useEffect(() => {
    jobsApi.list(1, 20).then((res) => setJobs(res.data.items ?? [])).catch(console.error)
  }, [latestJobStatus])

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

            {/* Live status toast */}
            {latestJobStatus && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-primary/40 bg-gradient-to-r from-brand/8 to-card px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15">
                    <Activity className="h-5 w-5 text-brand-light animate-pulse" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Thay đổi trạng thái gần nhất</p>
                    <p className="text-xs text-muted-fg mt-0.5">
                      Công việc{' '}
                      <span className="font-mono font-bold text-foreground">
                        {latestJobStatus.jobNo}
                      </span>{' '}
                      chuyển sang:
                    </p>
                  </div>
                </div>
                <StatusBadge status={latestJobStatus.status} />
              </div>
            )}

            {/* Jobs table */}
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-border px-6 py-4 bg-gradient-to-r from-surface-2 to-card">
                <CardTitle>Công việc sản xuất đang hoạt động</CardTitle>
                <CardDescription>Danh sách các lệnh in &amp; khắc laser tại trạm</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-surface-2">
                    <TableRow>
                      <TableHead className="pl-6">Mã công việc</TableHead>
                      <TableHead>Loại yêu cầu</TableHead>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead className="pr-6">Thời gian tạo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell className="pl-6 font-mono font-bold">{job.jobNo}</TableCell>
                        <TableCell className="text-muted-fg">{translateJobType(job.jobType)}</TableCell>
                        <TableCell className="font-mono">{job.productCode}</TableCell>
                        <TableCell><StatusBadge status={job.currentStatus} /></TableCell>
                        <TableCell className="pr-6 text-xs text-muted-fg">
                          {new Date(job.createdAt).toLocaleString('vi-VN')}
                        </TableCell>
                      </TableRow>
                    ))}
                    {jobs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-16 text-center text-muted-fg">
                          <LayoutDashboard className="h-10 w-10 mx-auto mb-3 opacity-20" />
                          Không tìm thấy công việc hoạt động nào.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
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
