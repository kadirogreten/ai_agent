import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Use mock values for development if not configured
const supabaseUrl = url || 'https://mock.supabase.co'
const supabaseAnonKey = anonKey || 'mock-key-for-development'

if (!url || !anonKey) {
  console.warn('Supabase not configured - using mock credentials for development')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

