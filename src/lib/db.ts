import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL,
  key =
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const configured = Boolean(url && key)
if (!configured) {
  console.warn(
    '[CampusPrep] Missing Supabase environment variables. Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your environment (or Vercel Project Settings).',
  )
}
export const db = createClient(
  url || 'http://127.0.0.1:54321',
  key || 'configuration-required',
)
export async function unwrap<T>(
  query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await query
  if (error) throw Error(error.message)
  return data as T
}
export const rpc = (name: string, args: Record<string, unknown> = {}) =>
  unwrap(db.rpc(name, args))
export function errorText(e: unknown) {
  return e instanceof Error
    ? e.message
    : e && typeof e === 'object' && 'message' in e
      ? String(e.message)
      : String(e)
}
