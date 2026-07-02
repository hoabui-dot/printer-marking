import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Search, Layers, Clipboard, AlertCircle, Play, CheckCircle, Send, XCircle, History } from 'lucide-react'
import { PageHeader, PermissionGuard, Spinner, EmptyState } from '@/components/common'
import { StatusBadge } from '@/components/industrial/StatusComponents'
import { apiGet, apiPost, apiPatch } from '@/services/api-client'
import { PERMISSIONS } from '@/utils/permissions'
import { formatRelative } from '@/utils/date'
import type { ProductionOrderDTO } from '@/types/domain'
import { toast } from '@/stores/toast.store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

export function ProductionOrdersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<string>('draft')
  const [dateFilter, setDateFilter] = React.useState<string>('today')
  const [startDate, setStartDate] = React.useState<string>(() => {
    const today = new Date()
    return today.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = React.useState<string>(() => {
    const today = new Date()
    return today.toISOString().split('T')[0]
  })
  const [selectedOrderId, setSelectedOrderId] = React.useState<string | null>(null)

  const handleStartDateChange = (val: string) => {
    setStartDate(val)
    if (endDate && val) {
      const s = new Date(val)
      const e = new Date(endDate)
      const diffTime = e.getTime() - s.getTime()
      const diffDays = diffTime / (1000 * 60 * 60 * 24)
      if (diffDays > 30) {
        const newEnd = new Date(s.getTime() + 30 * 24 * 60 * 60 * 1000)
        setEndDate(newEnd.toISOString().split('T')[0])
        toast.error(t('orders_module.rangeLimitWarning'))
      } else if (diffDays < 0) {
        setEndDate(val)
      }
    }
  }

  const handleEndDateChange = (val: string) => {
    setEndDate(val)
    if (startDate && val) {
      const s = new Date(startDate)
      const e = new Date(val)
      const diffTime = e.getTime() - s.getTime()
      const diffDays = diffTime / (1000 * 60 * 60 * 24)
      if (diffDays > 30) {
        const newStart = new Date(e.getTime() - 30 * 24 * 60 * 60 * 1000)
        setStartDate(newStart.toISOString().split('T')[0])
        toast.error(t('orders_module.rangeLimitWarning'))
      } else if (diffDays < 0) {
        setStartDate(val)
      }
    }
  }
  
  // Dialog state
  const [isCreateOpen, setIsCreateOpen] = React.useState(false)
  const [formOrderNumber, setFormOrderNumber] = React.useState('')
  const [formProductName, setFormProductName] = React.useState('')
  const [formQuantity, setFormQuantity] = React.useState(100)
  const [formPriority, setFormPriority] = React.useState<'low' | 'normal' | 'high' | 'urgent'>('normal')
  const [formOperationType, setFormOperationType] = React.useState<'PRINT_ONLY' | 'MARK_ONLY' | 'PRINT_AND_MARK'>('PRINT_AND_MARK')
  const [formStation, setFormStation] = React.useState('Station-Combined-01')
  const [formDueDate, setFormDueDate] = React.useState('')
  const [formNotes, setFormNotes] = React.useState('')

  const { data: res, isLoading } = useQuery({
    queryKey: ['production-orders'],
    queryFn: () => apiGet<ProductionOrderDTO[]>('/production-orders'),
  })

  const orders = res?.data ?? []

  const filteredOrders = orders.filter((o) => {
    const matchesSearch = o.order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          o.product_name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === 'all' || o.status === statusFilter

    let matchesDate = true
    const orderDate = new Date(o.created_at)
    const today = new Date()
    const orderDay = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate()).getTime()
    const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    
    if (dateFilter === 'today') {
      matchesDate = orderDay === todayDay
    } else if (dateFilter === '7days') {
      const diffDays = (todayDay - orderDay) / (1000 * 60 * 60 * 24)
      matchesDate = diffDays >= 0 && diffDays < 7
    } else if (dateFilter === 'month') {
      const diffDays = (todayDay - orderDay) / (1000 * 60 * 60 * 24)
      matchesDate = diffDays >= 0 && diffDays < 30
    } else if (dateFilter === 'custom' && startDate && endDate) {
      const start = new Date(startDate)
      const end = new Date(endDate)
      const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
      const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime()
      matchesDate = orderDay >= startDay && orderDay <= endDay
    }

    return matchesSearch && matchesStatus && matchesDate
  })

  const selectedOrder = orders.find((o) => o.id === selectedOrderId) ?? filteredOrders[0]

  React.useEffect(() => {
    if (filteredOrders.length > 0) {
      const exists = filteredOrders.some((o) => o.id === selectedOrderId)
      if (!exists) {
        setSelectedOrderId(filteredOrders[0].id)
      }
    } else {
      setSelectedOrderId(null)
    }
  }, [filteredOrders, selectedOrderId])

  // Real-time SSE listener
  React.useEffect(() => {
    if (!selectedOrderId) return

    const baseUrl = import.meta.env.VITE_API_URL || '/api/v1'
    const url = `${baseUrl.trimEnd('/')}/production-orders/${selectedOrderId}/stream`
    const eventSource = new EventSource(url)

    eventSource.addEventListener('order_update', (event) => {
      try {
        const updatedOrder = JSON.parse(event.data) as ProductionOrderDTO
        queryClient.setQueryData(['production-orders'], (oldData: any) => {
          if (!oldData || !oldData.data) return oldData
          const newOrders = oldData.data.map((o: ProductionOrderDTO) => 
            o.id === updatedOrder.id ? { ...o, ...updatedOrder } : o
          )
          return { ...oldData, data: newOrders }
        })
      } catch (err) {
        console.error('Failed to parse SSE event data', err)
      }
    })

    return () => {
      eventSource.close()
    }
  }, [selectedOrderId, queryClient])

  // Mutations
  const { mutate: createOrder, isPending: isCreating } = useMutation({
    mutationFn: (data: any) => apiPost('/production-orders', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-orders'] })
      setIsCreateOpen(false)
      toast.success('Đã tạo đơn hàng sản xuất mới thành công!')
      // Reset form
      setFormOrderNumber('')
      setFormProductName('')
      setFormQuantity(100)
      setFormPriority('normal')
      setFormOperationType('PRINT_AND_MARK')
      setFormStation('Station-Combined-01')
      setFormDueDate('')
      setFormNotes('')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Không thể tạo đơn hàng')
    }
  })

  const { mutate: releaseOrder, isPending: isReleasing } = useMutation({
    mutationFn: (id: string) => apiPatch(`/production-orders/${id}/release`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-orders'] })
      toast.success('Đã phê duyệt và phát hành đơn hàng đến Gateway!')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Không thể phát hành đơn hàng')
    }
  })

  const { mutate: cancelOrder, isPending: isCancelling } = useMutation({
    mutationFn: (id: string) => apiPatch(`/production-orders/${id}/cancel`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-orders'] })
      toast.success('Đã hủy đơn hàng sản xuất!')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Không thể hủy đơn hàng')
    }
  })

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Map priority to numeric
    let priorityNum = 40
    if (formPriority === 'low') priorityNum = 10
    else if (formPriority === 'high') priorityNum = 70
    else if (formPriority === 'urgent') priorityNum = 100

    createOrder({
      order_number: formOrderNumber,
      product_name: formProductName,
      quantity: formQuantity,
      priority: priorityNum,
      operation_type: formOperationType,
      station: formStation,
      due_date: formDueDate ? formDueDate : undefined,
      notes: formNotes,
    })
  }

  return (
    <div className="fade-in">
      <PageHeader
        title={t('orders_module.title')}
        description={t('orders_module.subtitle')}
      >
        <PermissionGuard permission={PERMISSIONS.PRODUCTION_CREATE}>
          <button className="btn btn-primary btn-sm" onClick={() => setIsCreateOpen(true)}>
            <Plus size={14} />
            {t('orders_module.addOrder')}
          </button>
        </PermissionGuard>
      </PageHeader>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 20, minHeight: '60vh' }}>
        {/* Left Side: Master List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input
                className="input"
                placeholder={t('common.search')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ paddingLeft: 36, width: '100%' }}
              />
            </div>
            <select
              className="select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ width: 140, height: 38 }}
            >
              <option value="all">{t('order_status.all')}</option>
              <option value="draft">{t('order_status.draft')}</option>
              <option value="released">{t('order_status.released')}</option>
              <option value="sent_to_gateway">{t('order_status.sent_to_gateway')}</option>
              <option value="accepted">{t('order_status.accepted')}</option>
              <option value="in_progress">{t('order_status.in_progress')}</option>
              <option value="completed">{t('order_status.completed')}</option>
              <option value="failed">{t('order_status.failed')}</option>
              <option value="cancelled">{t('order_status.cancelled')}</option>
            </select>
            <select
              className="select"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              style={{ width: 140, height: 38 }}
            >
              <option value="today">{t('orders_module.dateToday')}</option>
              <option value="7days">{t('orders_module.date7Days')}</option>
              <option value="month">{t('orders_module.dateMonth')}</option>
              <option value="custom">{t('orders_module.dateCustom')}</option>
            </select>
          </div>

          {dateFilter === 'custom' && (
            <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,0.01)', border: '1px dashed rgba(255,255,255,0.1)' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Khoảng:</span>
              <input 
                type="date" 
                className="input" 
                value={startDate} 
                onChange={(e) => handleStartDateChange(e.target.value)} 
                style={{ height: 34, padding: '4px 8px', fontSize: 13, flex: 1 }} 
              />
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>-</span>
              <input 
                type="date" 
                className="input" 
                value={endDate} 
                onChange={(e) => handleEndDateChange(e.target.value)} 
                style={{ height: 34, padding: '4px 8px', fontSize: 13, flex: 1 }} 
              />
            </div>
          )}

          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
              <Spinner size={32} />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', maxHeight: '70vh' }}>
              {filteredOrders.map((o) => {
                const completedQty = o.work_orders?.reduce((acc, curr) => acc + curr.quantity_completed, 0) ?? 0
                const targetQty = o.quantity
                const pct = targetQty > 0 ? Math.round((completedQty / targetQty) * 100) : 0

                return (
                  <div
                    key={o.id}
                    className={`card ${selectedOrderId === o.id ? 'border-accent' : ''}`}
                    onClick={() => setSelectedOrderId(o.id)}
                    style={{
                      padding: 16,
                      cursor: 'pointer',
                      border: selectedOrderId === o.id ? '1px solid var(--color-brand-orange)' : undefined,
                      background: selectedOrderId === o.id ? 'var(--color-bg-hover)' : undefined,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{o.order_number}</span>
                      <StatusBadge status={o.status} label={t(`order_status.${o.status}`, { defaultValue: o.status })} />
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{o.product_name}</div>
                    
                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                      <span>Type: <strong style={{ color: 'var(--color-text-secondary)' }}>{t(`operation_type.${o.operation_type}`, { defaultValue: o.operation_type })}</strong></span>
                      <span>Station: <strong style={{ color: 'var(--color-text-secondary)' }}>{o.station}</strong></span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                      <span>{t('orders_module.progress')}</span>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>{completedQty} / {targetQty} ({pct}%)</span>
                    </div>
                    <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: 'var(--color-brand-orange)', borderRadius: 3 }} />
                    </div>
                  </div>
                )
              })}
              {filteredOrders.length === 0 && (
                <EmptyState title={t('orders_module.noOrders')} />
              )}
            </div>
          )}
        </div>

        {/* Right Side: Details View */}
        <div>
          {selectedOrder ? (
            <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border-subtle)', paddingBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{selectedOrder.order_number}</h3>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>{selectedOrder.product_name}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <StatusBadge status={selectedOrder.status} label={t(`order_status.${selectedOrder.status}`, { defaultValue: selectedOrder.status })} />
                </div>
              </div>

              {/* Stats Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <div className="card" style={{ padding: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{t('orders_module.targetQty')}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{selectedOrder.quantity} {selectedOrder.unit || 'pcs'}</div>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{t('orders_module.integrationType')}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4, color: 'var(--color-text-secondary)' }}>{t(`operation_type.${selectedOrder.operation_type}`, { defaultValue: selectedOrder.operation_type })}</div>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{t('orders_module.integrationStation')}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4, color: 'var(--color-text-secondary)' }}>{selectedOrder.station}</div>
                </div>
              </div>

              {selectedOrder.gateway_order_id && (
                <div className="card" style={{ padding: '12px 16px', background: 'rgba(249, 115, 22, 0.05)', border: '1px solid rgba(249, 115, 22, 0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--color-brand-orange)' }}>Gateway Order ID (MQTT correlation)</div>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', marginTop: 2 }}>{selectedOrder.gateway_order_id}</div>
                  </div>
                  <div style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(249, 115, 22, 0.1)', color: 'var(--color-brand-orange)', fontWeight: 600 }}>
                    {t('orders_module.activeConnection')}
                  </div>
                </div>
              )}

              {/* Action Toolbar */}
              <div style={{ display: 'flex', gap: 12, borderBottom: '1px solid var(--color-border-subtle)', paddingBottom: 20 }}>
                {selectedOrder.status === 'draft' && (
                  <button 
                    className="btn btn-primary btn-sm" 
                    onClick={() => releaseOrder(selectedOrder.id)}
                    disabled={isReleasing}
                    style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                  >
                    <Send size={14} />
                    {isReleasing ? t('orders_module.releasing') : t('orders_module.release')}
                  </button>
                )}

                {['draft', 'released', 'sent_to_gateway'].includes(selectedOrder.status) && (
                  <button 
                    className="btn btn-outline-danger btn-sm" 
                    onClick={() => cancelOrder(selectedOrder.id)}
                    disabled={isCancelling}
                    style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                  >
                    <XCircle size={14} />
                    {t('orders_module.cancelOrder')}
                  </button>
                )}
              </div>

              {/* Timeline Section */}
              <div>
                <h4 style={{ margin: '0 0 16px 0', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <History size={14} />
                  {t('orders_module.timeline')}
                </h4>
                {selectedOrder.events && selectedOrder.events.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, background: 'rgba(255,255,255,0.01)', padding: 16, borderRadius: 8, border: '1px solid rgba(255,255,255,0.03)' }}>
                    {selectedOrder.events.map((ev, index) => (
                      <div key={ev.id} style={{ display: 'flex', gap: 12 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <div style={{ 
                            width: 10, 
                            height: 10, 
                            borderRadius: '50%', 
                            background: ev.status === 'failed' ? '#EF4444' : ev.status === 'completed' ? '#10B981' : ev.status === 'in_progress' ? '#3B82F6' : 'var(--color-brand-orange)', 
                            marginTop: 4 
                          }} />
                          {index < (selectedOrder.events?.length ?? 0) - 1 && (
                            <div style={{ width: 2, flex: 1, background: 'rgba(255,255,255,0.06)', marginTop: 8, minHeight: 20 }} />
                          )}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{ev.event_type}</span>
                            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{formatRelative(ev.occurred_at)}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{ev.message}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12, border: '1px dashed rgba(255,255,255,0.06)', borderRadius: 8 }}>
                    {t('orders_module.timelineEmpty')}
                  </div>
                )}
              </div>

              {/* Work Orders List */}
              <div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: 13, fontWeight: 700, textTransform: 'uppercase' }}>{t('orders_module.workOrders')}</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {selectedOrder.work_orders?.map((wo) => (
                    <div key={wo.id} className="card" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{wo.operation_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                          Step {wo.routing_step} • Assigned: {wo.assigned_worker_name || 'Unassigned'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <StatusBadge status={wo.status} label={t(`order_status.${wo.status}`, { defaultValue: wo.status })} />
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                          {wo.quantity_completed} / {wo.quantity_planned}
                        </div>
                      </div>
                    </div>
                  ))}
                  {(!selectedOrder.work_orders || selectedOrder.work_orders.length === 0) && (
                    <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
                      {t('orders_module.noOps')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40 }}>
              <EmptyState title={t('orders_module.noSelectedOrder')} description={t('orders_module.chooseOrder')} />
            </div>
          )}
        </div>
      </div>

      {/* Radix Create Order Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Tạo đơn hàng sản xuất mới</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
            <div className="form-group">
              <label className="label">Mã đơn hàng (Order Number)</label>
              <input 
                className="input" 
                value={formOrderNumber}
                onChange={(e) => setFormOrderNumber(e.target.value)}
                placeholder="Ví dụ: PO-2026-0001" 
                required 
              />
            </div>

            <div className="form-group">
              <label className="label">Tên sản phẩm (Product Name)</label>
              <input 
                className="input" 
                value={formProductName}
                onChange={(e) => setFormProductName(e.target.value)}
                placeholder="Ví dụ: FC-WP-RO100G-B" 
                required 
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="label">Số lượng</label>
                <input 
                  type="number"
                  className="input" 
                  value={formQuantity}
                  onChange={(e) => setFormQuantity(Number(e.target.value))}
                  min={1}
                  required 
                />
              </div>

              <div className="form-group">
                <label className="label">Độ ưu tiên</label>
                <select 
                  className="select" 
                  value={formPriority}
                  onChange={(e: any) => setFormPriority(e.target.value)}
                >
                  <option value="low">Thấp (Low)</option>
                  <option value="normal">Bình thường (Normal)</option>
                  <option value="high">Cao (High)</option>
                  <option value="urgent">Khẩn cấp (Urgent)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="label">Loại tích hợp (Operation)</label>
                <select 
                  className="select" 
                  value={formOperationType}
                  onChange={(e: any) => setFormOperationType(e.target.value)}
                >
                  <option value="PRINT_ONLY">PRINT_ONLY (In nhãn)</option>
                  <option value="MARK_ONLY">MARK_ONLY (Khắc laser)</option>
                  <option value="PRINT_AND_MARK">PRINT_AND_MARK (In & Khắc)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="label">Trạm tích hợp</label>
                <select 
                  className="select" 
                  value={formStation}
                  onChange={(e) => setFormStation(e.target.value)}
                >
                  <option value="Station-Combined-01">Station-Combined-01</option>
                  <option value="STATION-01">STATION-01</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="label">Hạn hoàn thành (Due Date)</label>
              <input 
                type="date"
                className="input" 
                value={formDueDate}
                onChange={(e) => setFormDueDate(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="label">Ghi chú (Notes)</label>
              <textarea 
                className="input" 
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={3}
                placeholder="Ghi chú sản xuất..."
              />
            </div>

            <DialogFooter className="mt-4">
              <button type="button" className="btn btn-outline" onClick={() => setIsCreateOpen(false)}>
                Hủy
              </button>
              <button type="submit" className="btn btn-primary" disabled={isCreating}>
                {isCreating ? 'Đang tạo...' : 'Tạo đơn hàng'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
