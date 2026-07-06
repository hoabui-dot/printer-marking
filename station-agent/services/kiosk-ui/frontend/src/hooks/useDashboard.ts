import { useEffect, useState } from 'react'
import * as signalR from '@microsoft/signalr'
import axios from 'axios'

export interface ProductionView {
  stationId: string
  jobId: string
  workOrderNo: string
  productCode: string
  productSerial?: string
  jobStatus: string
  updatedAt: string
}

export interface ActivityLog {
  id: string
  eventType: string
  jobId: string
  jobNo: string
  productCode: string
  status: string
  message: string
  occurredAt: string
}

export interface DeviceStatus {
  deviceId: string
  deviceType: string
  isOnline: boolean
  lastSeenAt: string
  lifecycleState?: string
}

export interface ProductionRecord {
  id: string
  jobId: string
  jobNo: string
  productCode: string
  productSerial?: string
  jobType: string
  currentStatus: string
  stationId: string
  createdAt: string
  updatedAt: string
}

export interface Alarm {
  id: string
  severity: string
  source: string
  message: string
  deviceId?: string
  isAcknowledged: boolean
  acknowledgedBy?: string
  acknowledgedAt?: string
  createdAt: string
}

export function useDashboard(stationId: string) {
  const [production, setProduction] = useState<ProductionView | null>(null)
  const [activities, setActivities] = useState<ActivityLog[]>([])
  const [devices, setDevices] = useState<DeviceStatus[]>([])
  const [todayRecords, setTodayRecords] = useState<ProductionRecord[]>([])
  const [alarms, setAlarms] = useState<Alarm[]>([])
  const [isConnected, setIsConnected] = useState(false)

  // Resolve absolute API / Hub URLs for the projection service proxy (routing through Kiosk UI backend)
  const baseUrl = import.meta.env.VITE_PROJECTION_URL || `${window.location.protocol}//${window.location.host}`;

  useEffect(() => {
    // 1. Initial REST fetch from projection service
    const fetchInitialData = async () => {
      try {
        const [prodRes, actRes, devRes, todayRecsRes, alarmsRes] = await Promise.all([
          axios.get<ProductionView>(`${baseUrl}/api/projection/production?stationId=${stationId}`).catch(() => null),
          axios.get<ActivityLog[]>(`${baseUrl}/api/projection/activities?limit=10`).catch(() => ({ data: [] })),
          axios.get<DeviceStatus[]>(`${baseUrl}/api/projection/devices`).catch(() => ({ data: [] })),
          axios.get<{ items: ProductionRecord[], totalCount: number }>(`${baseUrl}/api/projection/records/today?page=1&pageSize=100`).catch(() => ({ data: { items: [], totalCount: 0 } })),
          axios.get<Alarm[]>(`${baseUrl}/api/projection/alarms`).catch(() => ({ data: [] }))
        ])

        if (prodRes && prodRes.data) {
          setProduction(prodRes.data)
        }
        if (actRes && actRes.data) {
          setActivities(actRes.data)
        }
        if (devRes && devRes.data) {
          setDevices(devRes.data)
        }
        if (todayRecsRes && todayRecsRes.data?.items) {
          setTodayRecords(todayRecsRes.data.items)
        }
        if (alarmsRes && alarmsRes.data) {
          setAlarms(alarmsRes.data)
        }
      } catch (err) {
        console.error('Error fetching initial projection data:', err)
      }
    }

    fetchInitialData()

    // 2. SignalR Hub connection to projection service
    const conn = new signalR.HubConnectionBuilder()
      .withUrl(`${baseUrl}/hubs/production`)
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Information)
      .build()

    conn.on('OnProductionUpdate', (data: ProductionView) => {
      setProduction(data)
    })

    conn.on('OnActivityUpdate', (data: ActivityLog) => {
      setActivities((prev) => {
        // Prepend and trim to top 10
        const filtered = prev.filter((a) => a.id !== data.id)
        return [data, ...filtered].slice(0, 10)
      })
    })

    conn.on('OnProductionRecordUpdate', (data: ProductionRecord) => {
      setTodayRecords((prev) => {
        const exists = prev.some((r) => r.id === data.id)
        if (exists) {
          return prev.map((r) => (r.id === data.id ? data : r))
        } else {
          return [data, ...prev]
        }
      })
    })

    conn.on('OnDeviceStatusUpdate', (data: DeviceStatus) => {
      setDevices((prev) => {
        const exists = prev.some((d) => d.deviceId === data.deviceId)
        if (exists) {
          return prev.map((d) => (d.deviceId === data.deviceId ? data : d))
        } else {
          return [...prev, data]
        }
      })
    })

    conn.on('OnAlarmRaised', (data: Alarm) => {
      setAlarms((prev) => {
        const exists = prev.some((a) => a.id === data.id)
        if (exists) {
          return prev.map((a) => (a.id === data.id ? data : a))
        } else {
          return [data, ...prev]
        }
      })
    })

    conn.start()
      .then(async () => {
        setIsConnected(true)
        await conn.invoke('SubscribeToStation', stationId)
      })
      .catch((err) => console.error('SignalR connection error:', err))

    conn.onreconnected(() => setIsConnected(true))
    conn.onclose(() => setIsConnected(false))

    return () => {
      conn.stop()
    }
  }, [stationId, baseUrl])

  return { isConnected, production, activities, devices, todayRecords, alarms, setAlarms }
}
