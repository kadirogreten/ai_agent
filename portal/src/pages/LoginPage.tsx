import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

export default function LoginPage() {
  const navigate = useNavigate()
  const init = useAuthStore((s) => s.init)
  const session = useAuthStore((s) => s.session)
  const initialized = useAuthStore((s) => s.initialized)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    if (initialized && session) {
      navigate('/app/runs')
    }
  }, [initialized, session, navigate])

  async function signIn() {
    setLoading(true)
    setMsg(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setMsg(error.message)
    }
    setLoading(false)
  }

  async function signUp() {
    setLoading(true)
    setMsg(null)
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) {
      setMsg(error.message)
    } else {
      setMsg('Kayıt tamamlandı. E-posta doğrulaması gerekebilir.')
    }
    setLoading(false)
  }

  async function resetPassword() {
    if (!email) {
      setMsg('E-posta gerekli')
      return
    }
    setLoading(true)
    setMsg(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    if (error) {
      setMsg(error.message)
    } else {
      setMsg('Şifre sıfırlama e-postası gönderildi')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#0B1020] text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">
        <Card className="w-full max-w-md p-6">
          <div className="text-lg font-semibold">Giriş</div>
          <div className="mt-1 text-sm text-white/60">Runs, bundles ve knowledge facts portalı</div>
          <div className="mt-6 space-y-3">
            <div>
              <div className="mb-1 text-xs text-white/60">E-posta</div>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" />
            </div>
            <div>
              <div className="mb-1 text-xs text-white/60">Şifre</div>
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
              />
            </div>
            {msg ? <div className="rounded-md border border-white/10 bg-white/5 p-3 text-xs text-white/80">{msg}</div> : null}
            {mode === 'signin' ? (
              <Button className="w-full" onClick={signIn} disabled={loading || !email || !password}>
                Giriş Yap
              </Button>
            ) : (
              <Button className="w-full" onClick={signUp} disabled={loading || !email || !password}>
                Hesap Oluştur
              </Button>
            )}
            <Button className="w-full" variant="secondary" onClick={resetPassword} disabled={loading || !email}>
              Şifremi unuttum
            </Button>
            <Button
              className="w-full"
              variant="ghost"
              onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
              disabled={loading}
            >
              {mode === 'signin' ? 'Hesap oluştur' : 'Girişe dön'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
