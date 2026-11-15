import { createClient } from 'npm:@supabase/supabase-js@2.99.1'
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization,apikey,x-client-info,content-type',
}
const response = (v: unknown, status = 200) =>
  Response.json(v, { status, headers })
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return response({ error: 'POST required' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!,
    key = Deno.env.get('SUPABASE_ANON_KEY')!,
    authorization = req.headers.get('authorization') || ''
  const client = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
  })
  const {
    data: { user },
    error,
  } = await client.auth.getUser(authorization.replace(/^Bearer /i, ''))
  if (error || !user) return response({ error: 'Sign in required' }, 401)
  const { data: p } = await client
    .from('profiles')
    .select('role,status')
    .eq('id', user.id)
    .single()
  if (p?.role !== 'admin' || p.status !== 'approved')
    return response({ error: 'Administrator required' }, 403)
  let body
  try {
    body = await req.json()
  } catch {
    return response({ error: 'Invalid JSON' }, 400)
  }
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 100)
    return response({ error: 'Import 1 to 100 students at a time' }, 400)
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const origin = Deno.env.get('APP_ORIGIN')
  if (!origin)
    return response(
      {
        error:
          'Configure the APP_ORIGIN function secret before inviting students.',
      },
      503,
    )
  const results = []
  for (const [i, row] of body.rows.entries()) {
    const email = String(row?.email ?? '')
        .trim()
        .toLowerCase(),
      full_name = String(row?.full_name ?? '').trim(),
      roll_no = String(row?.roll_no ?? '')
        .trim()
        .toUpperCase(),
      phone = String(row?.phone ?? '').trim()
    if (
      !/^\S+@\S+\.\S+$/.test(email) ||
      full_name.length < 2 ||
      full_name.length > 120 ||
      !/^[A-Z0-9][A-Z0-9./_-]{2,49}$/.test(roll_no) ||
      !/^\+?[0-9 ()-]{7,20}$/.test(phone)
    ) {
      results.push({ row: i + 2, email, status: 'Invalid student details' })
      continue
    }
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name, roll_no, phone },
      redirectTo: origin.replace(/\/$/, '') + '/reset',
    })
    results.push({
      row: i + 2,
      email,
      status: error ? error.message : 'Invited • pending approval',
    })
  }
  return response({ results })
})
