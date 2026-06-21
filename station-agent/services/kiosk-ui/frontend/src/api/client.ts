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
  me: () => client.get<{ userId: string; username: string; roles: string[]; permissions: string[] }>('/auth/me'),
}

export const rbacApi = {
  getUsers: () => client.get<any[]>('/rbac/users'),
  createUser: (data: { username: string; password?: string; fullName: string; roleCode: string }) =>
    client.post('/rbac/users', data),
  deleteUser: (id: string) => client.delete(`/rbac/users/${id}`),
  getPermissions: () => client.get<any[]>('/rbac/permissions'),
  updateUserPermissions: (userId: string, permissionCodes: string[]) =>
    client.post(`/rbac/users/${userId}/permissions`, { permissionCodes })
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
