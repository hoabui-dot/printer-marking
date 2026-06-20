import { useEffect, useState } from 'react'
import * as signalR from '@microsoft/signalr'

export interface JobStatusEvent {
  jobId: string
  jobNo: string
  status: string
  attemptNo: number
  occurredAt: string
}

export function useDashboard(stationId: string) {
  const [connection, setConnection] = useState<signalR.HubConnection | null>(null)
  const [latestJobStatus, setLatestJobStatus] = useState<JobStatusEvent | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('token')

    const conn = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/dashboard', { accessTokenFactory: () => token ?? '' })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Information)
      .build()

    conn.on('JobStatusChanged', (data: JobStatusEvent) => {
      setLatestJobStatus(data)
    })

    conn.start()
      .then(async () => {
        setIsConnected(true)
        await conn.invoke('JoinStationGroup', stationId)
      })
      .catch(err => console.error('SignalR connection error:', err))

    conn.onreconnected(() => setIsConnected(true))
    conn.onclose(() => setIsConnected(false))

    setConnection(conn)

    return () => { conn.stop() }
  }, [stationId])

  return { isConnected, latestJobStatus, connection }
}
