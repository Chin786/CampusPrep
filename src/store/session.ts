import { create } from 'zustand'
import { db, unwrap } from '../lib/db'
import type { Profile } from '../types'
type Session = {
  profile: Profile | null
  loading: boolean
  error: string
  refresh: () => Promise<void>
}
let revision = 0
export const useSession = create<Session>((set) => ({
  profile: null,
  loading: true,
  error: '',
  refresh: async () => {
    const current = ++revision
    try {
      const { data, error } = await db.auth.getSession()
      if (error) throw error
      let profile: Profile | null = null
      if (data.session) {
        const { data: p, error: pErr } = await db
          .from('profiles')
          .select('*')
          .eq('id', data.session.user.id)
          .maybeSingle()
        if (pErr) throw pErr
        if (!p) {
          await db.auth.signOut()
        } else {
          profile = p as Profile
        }
      }
      if (current === revision) set({ profile, loading: false, error: '' })
    } catch (e) {
      if (current === revision)
        set({ profile: null, loading: false, error: (e as Error).message })
    }
  },
}))
