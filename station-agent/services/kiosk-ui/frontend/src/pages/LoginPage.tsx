import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { AlertCircle, Flame } from 'lucide-react'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await authApi.login(username, password)
      await login(res.data.token, res.data.userId, res.data.username)
      navigate('/')
    } catch {
      setError('Tên đăng nhập hoặc mật khẩu không chính xác')
    } finally {
      setLoading(false)
    }
  }


  return (
    <div className="flex min-h-screen items-center justify-center p-6"
      style={{ background: 'radial-gradient(ellipse at 60% 20%, hsl(16 80% 12%) 0%, hsl(220 20% 6%) 70%)' }}
    >
      {/* Background decorative glow */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, hsl(16 90% 52%) 0%, transparent 70%)' }}
        />
      </div>

      <Card className="relative w-full max-w-md border-border-strong shadow-2xl overflow-hidden">
        {/* Top brand stripe */}
        <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, hsl(var(--brand-dark)), hsl(var(--brand-light)))' }} />

        <CardHeader className="p-8 pb-4 text-center space-y-3">
          {/* Logo mark */}
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg"
            style={{ background: 'linear-gradient(135deg, hsl(var(--brand-dark)), hsl(var(--brand-light)))' }}
          >
            <Flame className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Kiosk Trạm ND</h1>
            <p className="text-sm text-muted-fg mt-1">
              Hệ thống quản lý in &amp; khắc laser
            </p>
          </div>
        </CardHeader>

        <CardContent className="p-8 pt-0">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="username">Tên đăng nhập</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                placeholder="Nhập tên đăng nhập"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Mật khẩu</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 text-base font-semibold mt-2"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                  </svg>
                  Đang đăng nhập...
                </span>
              ) : 'Đăng nhập'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
