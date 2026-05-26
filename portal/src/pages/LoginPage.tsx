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
        background: 'radial-gradient(ellipse at 50% 0%, #0f2244 0%, #060c18 60%)',
      }}
    >
      {/* Arka plan ışık lekeleri */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-[500px] w-[500px] rounded-full opacity-[0.18] blur-3xl"
          style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }} />
        <div className="absolute -right-24 bottom-0 h-[400px] w-[400px] rounded-full opacity-[0.10] blur-3xl"
          style={{ background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)' }} />
        {/* Subtle grid */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-4">
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{
              background: 'linear-gradient(135deg, rgba(59,130,246,0.3) 0%, rgba(37,99,235,0.15) 100%)',
              boxShadow: '0 0 0 1px rgba(59,130,246,0.3), 0 8px 32px rgba(59,130,246,0.2)',
            }}
          >
            <Bot size={26} className="text-blue-300" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight text-white">Agent Portal</h1>
            <p className="mt-1 text-xs text-white/40">AI ajan yönetim platformu</p>
          </div>
        </div>

        {/* Kart */}
        <div
          className="rounded-2xl p-6 shadow-2xl backdrop-blur-sm"
          style={{
            background: 'linear-gradient(160deg, rgba(15,24,41,0.95) 0%, rgba(10,16,32,0.95) 100%)',
            border: '1px solid rgba(255,255,255,0.09)',
            boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(59,130,246,0.05)',
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
