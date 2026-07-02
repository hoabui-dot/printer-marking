import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Search, Layers, Clipboard, AlertCircle, Play, CheckCircle } from 'lucide-react'
import { PageHeader, PermissionGuard, Spinner, EmptyState } from '@/components/common'
import { StatusBadge } from '@/components/industrial/StatusComponents'
import { apiGet } from '@/services/api-client'
import { PERMISSIONS } from '@/utils/permissions'
import { formatRelative } from '@/utils/date'
import type { ProductionOrderDTO } from '@/types/domain'

export function ProductionOrdersPage() {
  const { t } = useTranslation()
  const [searchTerm, setSearchTerm] = React.useState('')
  const [selectedOrderId, setSelectedOrderId] = React.useState<string | null>(null)

  const { data: res, isLoading } = useQuery({
    queryKey: ['production-orders'],
    queryFn: () => apiGet<ProductionOrderDTO[]>('/production/orders'),
  })

  const orders = res?.data ?? []

  const filteredOrders = orders.filter((o) => 
    o.order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    o.product_name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const selectedOrder = orders.find((o) => o.id === selectedOrderId) ?? filteredOrders[0]

  React.useEffect(() => {
    if (selectedOrder && !selectedOrderId) {
      setSelectedOrderId(selectedOrder.id)
    }
  }, [selectedOrder, selectedOrderId])

  return (
    <div className="fade-in">
      <PageHeader
        title={t('orders_module.title')}
        description={t('orders_module.subtitle')}
      >
        <PermissionGuard permission={PERMISSIONS.PRODUCTION_CREATE}>
          <button className="btn btn-primary btn-sm">
            <Plus size={14} />
            {t('orders_module.addOrder')}
          </button>
        </PermissionGuard>
      </PageHeader>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, minHeight: '60vh' }}>
        {/* Left Side: Master List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center' }}>
            <Search size={14} style={{ color: 'var(--color-text-muted)' }} />
            <input
              className="input"
              placeholder={t('common.search')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
              <Spinner size={32} />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', maxHeight: '60vh' }}>
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
                      <StatusBadge status={o.status} />
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{o.product_name}</div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                      <span>Progress</span>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>{completedQty} / {targetQty} ({pct}%)</span>
                    </div>
                    <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: 'var(--color-brand-orange)', borderRadius: 3 }} />
                    </div>
                  </div>
                )
              })}
              {filteredOrders.length === 0 && (
                <EmptyState title="No production orders found" />
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
                <StatusBadge status={selectedOrder.status} />
              </div>

              {/* Stats Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="card" style={{ padding: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Target Quantity</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{selectedOrder.quantity} {selectedOrder.unit}</div>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Priority</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4, textTransform: 'capitalize', color: selectedOrder.priority === 'urgent' ? '#EF4444' : '#F97316' }}>
                    {selectedOrder.priority}
                  </div>
                </div>
              </div>

              {/* Work Orders List */}
              <div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: 13, fontWeight: 700, textTransform: 'uppercase' }}>Work Orders / Operations</h4>
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
                        <StatusBadge status={wo.status} />
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                          {wo.quantity_completed} / {wo.quantity_planned}
                        </div>
                      </div>
                    </div>
                  ))}
                  {(!selectedOrder.work_orders || selectedOrder.work_orders.length === 0) && (
                    <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
                      No operations defined
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40 }}>
              <EmptyState title="No Order Selected" description="Choose an order from the list to inspect routing progress." />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
