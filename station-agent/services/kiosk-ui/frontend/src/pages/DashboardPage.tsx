import { useEffect, useState } from 'react'
import { useDashboard } from '../hooks/useDashboard'
import { jobsApi } from '../api/client'

export default function DashboardPage() {
  const stationId = 'STATION-01'
  const { isConnected, latestJobStatus } = useDashboard(stationId)
  const [jobs, setJobs] = useState<any[]>([])

  useEffect(() => {
    jobsApi.list(1, 20).then(res => setJobs(res.data.items ?? []))
  }, [latestJobStatus])

  const statusColor = (status: string) => {
    const map: Record<string, string> = {
      COMPLETED: '#22c55e', FAILED: '#ef4444', PROCESSING: '#3b82f6',
      WAIT_REWORK: '#f59e0b', QUEUED: '#a78bfa', CREATED: '#94a3b8', CANCELLED: '#64748b'
    }
    return map[status] ?? '#94a3b8'
  }

  return (
    <div style={{ padding: '2rem', background: '#0f172a', minHeight: '100vh', color: '#f1f5f9' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem' }}>Station Dashboard — {stationId}</h1>
        <span style={{ background: isConnected ? '#166534' : '#7f1d1d', padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.875rem' }}>
          {isConnected ? 'Live' : 'Disconnected'}
        </span>
      </div>

      {latestJobStatus && (
        <div style={{ background: '#1e293b', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', borderLeft: '4px solid #3b82f6' }}>
          <strong>Latest:</strong> Job {latestJobStatus.jobNo} &rarr; <span style={{ color: statusColor(latestJobStatus.status) }}>{latestJobStatus.status}</span>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ background: '#1e293b', textAlign: 'left' }}>
            <th style={{ padding: '0.75rem' }}>Job No</th>
            <th style={{ padding: '0.75rem' }}>Type</th>
            <th style={{ padding: '0.75rem' }}>Product</th>
            <th style={{ padding: '0.75rem' }}>Status</th>
            <th style={{ padding: '0.75rem' }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => (
            <tr key={job.id} style={{ borderBottom: '1px solid #334155' }}>
              <td style={{ padding: '0.75rem' }}>{job.jobNo}</td>
              <td style={{ padding: '0.75rem' }}>{job.jobType}</td>
              <td style={{ padding: '0.75rem' }}>{job.productCode}</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ background: statusColor(job.currentStatus), padding: '0.2rem 0.5rem', borderRadius: '4px', color: 'white', fontSize: '0.75rem' }}>
                  {job.currentStatus}
                </span>
              </td>
              <td style={{ padding: '0.75rem', color: '#94a3b8' }}>{new Date(job.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
