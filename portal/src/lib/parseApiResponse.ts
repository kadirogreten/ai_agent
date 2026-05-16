export type ApiEnvelope<T> = {
  success?: boolean
  error?: string
} & T

/** Detect SPA/HTML mistaken for API JSON (common when /api is not proxied). */
export function looksLikeHtmlResponse(text: string): boolean {
  const t = text.trimStart().slice(0, 200).toLowerCase()
  return t.startsWith('<!doctype') || t.startsWith('<html') || t.startsWith('<!')
}

export function parseApiResponse<T extends ApiEnvelope<unknown>>(
  text: string,
  res: Response,
  fallbackLabel: string,
): { ok: true; data: T } | { ok: false; error: string } {
  if (looksLikeHtmlResponse(text)) {
    return {
      ok: false,
      error:
        `${fallbackLabel}: Yanıt JSON değil (HTML alındı). API sunucusu veya Vite proxy kapalı olabilir. ` +
        `Geliştirmede \`npm run dev\` kullanın; production'da /api/health kontrol edin.`,
    }
  }

  let json: T | null = null
  try {
    json = JSON.parse(text) as T
  } catch {
    const preview = text.trim().slice(0, 120).replace(/\s+/g, ' ')
    return {
      ok: false,
      error: `${fallbackLabel}: Geçersiz JSON (HTTP ${res.status}). Önizleme: ${preview || '(boş)'}`,
    }
  }

  if (!res.ok) {
    return {
      ok: false,
      error: json?.error ?? `${fallbackLabel} (HTTP ${res.status})`,
    }
  }

  if (!json?.success) {
    return {
      ok: false,
      error: json?.error ?? `${fallbackLabel} (HTTP ${res.status}, success=false)`,
    }
  }

  return { ok: true, data: json }
}
