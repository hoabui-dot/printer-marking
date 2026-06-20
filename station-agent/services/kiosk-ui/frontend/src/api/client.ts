import axios from 'axios'

const client = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' }
})

client.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

client.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default client

export const authApi = {
  login: (username: string, password: string) =>
    client.post<{ token: string; userId: string; username: string; fullName: string; expiresAt: string }>(
      '/auth/login', { username, password }
    ),
  me: () => client.get<{ userId: string; username: string }>('/auth/me'),
}

export const jobsApi = {
  list: (page = 1, pageSize = 20, status?: string) =>
    client.get('/jobs', { params: { page, pageSize, status } }),
  getById: (id: string) => client.get(`/jobs/${id}`),
  getHistory: (id: string) => client.get(`/jobs/${id}/history`),
  getAttempts: (id: string) => client.get(`/jobs/${id}/attempts`),
}

export const overwriteApi = {
  getPending: () => client.get('/overwrite-requests/pending'),
  create: (jobId: string, overwriteType: string, reason: string) =>
    client.post('/overwrite-requests', { jobId, overwriteType, reason }),
}
