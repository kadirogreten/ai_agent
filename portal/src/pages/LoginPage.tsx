import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { useAuthStore } from '@/stores/authStore'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { motion } from 'framer-motion'
import { Bot, Mail, Lock, ArrowRight } from 'lucide-react'

export default function LoginPage() {
  const navigate    = useNavigate()
  const init        = useAuthStore((s) => s.init)
  const session     = useAuthStore((s) => s.session)
  const initialized = useAuthStore((s) => s.initialized)

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [msg,      setMsg]      = useState<string | null>(null)
  const [msgOk,    setMsgOk]    = useState(false)
  const [mode,     setMode]     = useState<'signin' | 'signup'>('signin')

  useEffect(() => { init() }, [init])
  useEffect(() => {
    if (initialized && session) navigate('/app/dashboard')
  }, [initialized, session, navigate])

  async function signIn() {
    setLoading(true); setMsg(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setMsg(error.message); setMsgOk(false) }
    setLoading(false)
  }

  async function signUp() {
    setLoading(true); setMsg(null)
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) { setMsg(error.message); setMsgOk(false) }
    else { setMsg('Kayıt tamamlandı. E-posta doğrulaması gerekebilir.'); setMsgOk(true) }
    setLoading(false)
  }

  async function resetPassword() {
    if (!email) { setMsg('E-posta gerekli'); setMsgOk(false); return }
    setLoading(true); setMsg(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    if (error) { setMsg(error.message); setMsgOk(false) }
    else { setMsg('Şifre sıfırlama e-postası gönderildi.'); setMsgOk(true) }
    setLoading(false)
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{
        background: 'radial-gradient(ellipse at 50% -10%, #1e3a5f 0%, #070d1a 55%)',
      }}
    >
      {/* Arka plan ışık lekeleri */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full opacity-10 blur-3xl"
          style={{ background: '#3b82f6' }} />
        <div className="absolute -right-32 bottom-0 h-96 w-96 rounded-full opacity-5 blur-3xl"
          style={{ background: '#8b5cf6' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/20 ring-1 ring-blue-500/30">
            <Bot size={22} className="text-blue-400" />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-semibold text-white/90">Agent Portal</h1>
            <p className="text-xs text-white/40">AI ajan yönetim platformu</p>
          </div>
        </div>

        {/* Kart */}
        <div
          className="rounded-2xl p-6 shadow-2xl"
          style={{
            background: 'linear-gradient(160deg, #0f1829 0%, #0a1020 100%)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div className="mb-5 text-sm font-medium text-white/70">
            {mode === 'signin' ? 'Hesabınıza giriş yapın' : 'Yeni hesap oluşturun'}
          </div>

          <div className="space-y-3">
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                placeholder="E-posta"
                className="pl-9"
              />
            </div>
            {mode !== 'signup' || mode === 'signup' ? (
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete="current-password"
                  placeholder="Şifre"
                  className="pl-9"
                />
              </div>
            ) : null}

            {msg && (
              <div className={`rounded-lg px-3 py-2 text-xs ${
                msgOk
                  ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                  : 'border border-red-500/20 bg-red-500/10 text-red-300'
              }`}>
                {msg}
              </div>
            )}

            {mode === 'signin' ? (
              <Button
                className="w-full"
                onClick={signIn}
                disabled={loading || !email || !password}
              >
                Giriş Yap
                <ArrowRight size={14} className="ml-1.5" />
              </Button>
            ) : (
              <Button
                className="w-full"
                onClick={signUp}
                disabled={loading || !email || !password}
              >
                Hesap Oluştur
                <ArrowRight size={14} className="ml-1.5" />
              </Button>
            )}

            <div className="flex gap-2">
              <Button
                className="flex-1"
                variant="ghost"
                size="sm"
                onClick={resetPassword}
                disabled={loading || !email}
              >
                Şifremi unuttum
              </Button>
              <Button
                className="flex-1"
                variant="ghost"
                size="sm"
                onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
                disabled={loading}
              >
                {mode === 'signin' ? 'Hesap oluştur' : 'Giriş yap'}
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
