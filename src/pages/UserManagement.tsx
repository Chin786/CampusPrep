import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { db, unwrap, rpc, errorText } from '../lib/db'
import {
  Feedback,
  Loading,
  Title,
  fetchAll,
  useData,
  useTask,
} from '../components/Common'
import { useSession } from '../store/session'
import type { Profile, UserRole } from '../types'
import {
  ShieldAlert,
  UserCheck,
  GraduationCap,
  PenTool,
  Shield,
  Pencil,
  Trash2,
  AlertTriangle,
  X,
  UserPlus,
} from 'lucide-react'

const roleLabels: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Administrator',
  content_author: 'Faculty (Author)',
  student: 'Student',
}

const roleColors: Record<UserRole, { bg: string; text: string; border: string }> = {
  super_admin: { bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe' },
  admin: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  content_author: { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' },
  student: { bg: '#f8fafc', text: '#334155', border: '#cbd5e1' },
}

const statusColors: Record<Profile['status'], { bg: string; text: string }> = {
  approved: { bg: '#dcfce7', text: '#166534' },
  pending: { bg: '#fef9c3', text: '#854d0e' },
  rejected: { bg: '#fee2e2', text: '#991b1b' },
  blocked: { bg: '#f1f5f9', text: '#475569' },
}

export function UserManagement() {
  const currentProfile = useSession((s) => s.profile)!
  const isSuperAdmin = currentProfile.role === 'super_admin'

  const d = useData(() =>
    fetchAll<Profile>((f, t) =>
      db
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .range(f, t),
    ),
  )

  const task = useTask()
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showRoleInfo, setShowRoleInfo] = useState(false)

  // Create User State
  const initialCreateForm = {
    full_name: '',
    email: '',
    password: '',
    roll_no: '',
    phone: '',
    role: 'student' as UserRole,
    status: 'approved' as Profile['status'],
    autoConfirm: true,
  }
  const [creatingUser, setCreatingUser] = useState(false)
  const [createForm, setCreateForm] = useState(initialCreateForm)

  // Edit User State
  const [editingUser, setEditingUser] = useState<Profile | null>(null)
  const [editForm, setEditForm] = useState<{
    full_name: string
    roll_no: string
    phone: string
    role: UserRole
    status: Profile['status']
  }>({
    full_name: '',
    roll_no: '',
    phone: '',
    role: 'student',
    status: 'pending',
  })

  // Delete User State
  const [deletingUser, setDeletingUser] = useState<Profile | null>(null)

  if (!d.data) return <Loading error={d.error} />

  const allProfiles = d.data

  const counts = {
    total: allProfiles.length,
    super_admin: allProfiles.filter((p) => p.role === 'super_admin').length,
    admin: allProfiles.filter((p) => p.role === 'admin').length,
    content_author: allProfiles.filter((p) => p.role === 'content_author').length,
    student: allProfiles.filter((p) => p.role === 'student').length,
    pending: allProfiles.filter((p) => p.status === 'pending').length,
  }

  const filtered = allProfiles.filter((p) => {
    const matchesRole = roleFilter === 'all' || p.role === roleFilter
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter
    const q = query.toLowerCase()
    const matchesSearch =
      !query ||
      [p.full_name, p.email, p.roll_no, p.phone || '']
        .join(' ')
        .toLowerCase()
        .includes(q)
    return matchesRole && matchesStatus && matchesSearch
  })

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault()

    if (!createForm.full_name.trim()) {
      alert('Full name is required.')
      return
    }
    if (!createForm.email.trim()) {
      alert('Email address is required.')
      return
    }
    if (createForm.password.length < 8) {
      alert('Password must be at least 8 characters.')
      return
    }
    if (!createForm.roll_no.trim()) {
      alert('Roll number / Identifier is required.')
      return
    }
    if (!createForm.phone.trim()) {
      alert('Phone number is required.')
      return
    }

    if ((createForm.role === 'admin' || createForm.role === 'super_admin') && !isSuperAdmin) {
      alert('Only Super Administrators can create Administrator or Super Administrator accounts.')
      return
    }

    task.run(async () => {
      // Create a temporary client with persistSession: false so the active admin session is not replaced
      const tempClient = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        },
      )

      const { data: signUpData, error: signUpErr } = await tempClient.auth.signUp({
        email: createForm.email.trim(),
        password: createForm.password,
        options: {
          data: {
            full_name: createForm.full_name.trim(),
            roll_no: createForm.roll_no.trim().toUpperCase(),
            phone: createForm.phone.trim(),
          },
        },
      })

      if (signUpErr) throw signUpErr
      if (!signUpData.user) throw Error('User registration failed in Auth service.')

      const newUserId = signUpData.user.id

      // Auto-confirm email if requested
      if (createForm.autoConfirm) {
        try {
          await rpc('admin_confirm_user_email', { target_id: newUserId })
        } catch {
          // RPC may not be applied yet, non-blocking
        }
      }

      // If role or status differs from default (student/pending), apply updates
      if (createForm.role !== 'student' || createForm.status !== 'pending') {
        // Wait briefly for the DB trigger to create the profile row
        await new Promise((resolve) => setTimeout(resolve, 600))

        try {
          await rpc('update_user_profile', {
            target_id: newUserId,
            new_name: createForm.full_name.trim(),
            new_roll: createForm.roll_no.trim().toUpperCase(),
            new_phone: createForm.phone.trim(),
            new_role: createForm.role,
            new_status: createForm.status,
          })
        } catch {
          await unwrap(
            db
              .from('profiles')
              .update({
                role: createForm.role,
                status: createForm.status,
              })
              .eq('id', newUserId),
          )
        }
      }

      setCreatingUser(false)
      setCreateForm({ ...initialCreateForm })
      d.reload()
    }, `User ${createForm.full_name} created successfully as ${roleLabels[createForm.role]}`)
  }

  function startEdit(user: Profile) {
    setEditingUser(user)
    setEditForm({
      full_name: user.full_name,
      roll_no: user.roll_no,
      phone: user.phone || '',
      role: user.role,
      status: user.status,
    })
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingUser) return

    if (!editForm.full_name.trim()) {
      alert('Full name is required.')
      return
    }
    if (!editForm.roll_no.trim()) {
      alert('Roll number / Identifier is required.')
      return
    }

    // Protection: Super Admin cannot be blocked
    if (
      (editingUser.role === 'super_admin' || editForm.role === 'super_admin') &&
      editForm.status === 'blocked'
    ) {
      alert('A Super Administrator account cannot be blocked.')
      return
    }

    // Protection: Only Super Admin can assign admin or super_admin
    if (
      (editForm.role === 'admin' || editForm.role === 'super_admin') &&
      !isSuperAdmin &&
      editingUser.role !== editForm.role
    ) {
      alert('Only Super Administrators can assign Administrator or Super Administrator roles.')
      return
    }

    // Self protection
    if (editingUser.id === currentProfile.id && editForm.status !== 'approved') {
      alert('You cannot change or block your own active status.')
      return
    }

    task.run(async () => {
      try {
        await rpc('update_user_profile', {
          target_id: editingUser.id,
          new_name: editForm.full_name,
          new_roll: editForm.roll_no,
          new_phone: editForm.phone,
          new_role: editForm.role,
          new_status: editForm.status,
        })
      } catch {
        await unwrap(
          db
            .from('profiles')
            .update({
              full_name: editForm.full_name.trim(),
              roll_no: editForm.roll_no.trim().toUpperCase(),
              phone: editForm.phone.trim(),
              role: editForm.role,
              status: editForm.status,
            })
            .eq('id', editingUser.id),
        )
      }
      setEditingUser(null)
      d.reload()
    }, `User ${editForm.full_name} updated successfully`)
  }

  async function confirmDelete() {
    if (!deletingUser) return
    const target = deletingUser

    if (target.id === currentProfile.id) {
      alert('You cannot delete your own account.')
      return
    }
    if (target.role === 'super_admin') {
      alert('A Super Administrator account cannot be deleted.')
      return
    }
    if (target.role === 'admin' && !isSuperAdmin) {
      alert('Only Super Administrators can delete an Administrator account.')
      return
    }

    task.run(async () => {
      let rpcSucceeded = false
      try {
        await rpc('delete_user_account', { target_id: target.id })
        rpcSucceeded = true
      } catch {
        rpcSucceeded = false
      }

      if (!rpcSucceeded) {
        // Cascade delete related records before deleting profile
        const { data: userAttempts } = await db
          .from('attempts')
          .select('id')
          .eq('student_id', target.id)

        if (userAttempts && userAttempts.length > 0) {
          const aIds = userAttempts.map((a: { id: string }) => a.id)
          await db.from('violations').delete().in('attempt_id', aIds)
          await db.from('responses').delete().in('attempt_id', aIds)
          await db.from('attempts').delete().eq('student_id', target.id)
        }

        await db.from('schedule_assignments').delete().eq('student_id', target.id)
        await db.from('group_members').delete().eq('student_id', target.id)
        await db.from('questions').update({ created_by: null }).eq('created_by', target.id)
        await db.from('tests').update({ created_by: null }).eq('created_by', target.id)

        await unwrap(db.from('profiles').delete().eq('id', target.id))
      }

      setDeletingUser(null)
      setSelectedIds((prev) => prev.filter((id) => id !== target.id))
      d.reload()
    }, `Account for ${target.full_name} deleted`)
  }

  async function updateUserRole(userId: string, newRole: UserRole) {
    if (userId === currentProfile.id && newRole !== 'super_admin' && counts.super_admin <= 1) {
      alert('You cannot demote yourself while being the only Super Administrator.')
      return
    }

    task.run(async () => {
      try {
        await rpc('manage_user_role', { target_id: userId, target_role: newRole })
      } catch {
        await unwrap(db.from('profiles').update({ role: newRole }).eq('id', userId))
      }
      d.reload()
    }, `Role updated to ${roleLabels[newRole]}`)
  }

  async function updateUserStatus(userId: string, newStatus: Profile['status']) {
    const targetUser = allProfiles.find((p) => p.id === userId)
    if (!targetUser) return

    // Rule 1: A super_admin account can NEVER be blocked
    if (targetUser.role === 'super_admin' && newStatus === 'blocked') {
      alert('A Super Administrator account cannot be blocked.')
      return
    }

    // Rule 2: Cannot change or block your own active account status
    if (userId === currentProfile.id && newStatus !== 'approved') {
      alert('You cannot change or block your own active status.')
      return
    }

    // Rule 3: Only super_admin can block or modify the status of an admin account
    if (targetUser.role === 'admin' && !isSuperAdmin) {
      alert('Only Super Administrators have permission to change or block Administrator accounts.')
      return
    }

    task.run(async () => {
      try {
        await rpc('manage_user_status', { target_id: userId, target_status: newStatus })
      } catch {
        await unwrap(db.from('profiles').update({ status: newStatus }).eq('id', userId))
      }
      d.reload()
    }, `Account status updated to ${newStatus}`)
  }

  async function batchUpdateStatus(keys: string[], status: Profile['status']) {
    if (!keys.length) return

    let targetKeys = [...keys]

    if (status === 'blocked') {
      const hasSuperAdmin = allProfiles.some(
        (p) => targetKeys.includes(p.id) && p.role === 'super_admin',
      )
      if (hasSuperAdmin) {
        alert('Super Administrator accounts cannot be blocked and were automatically excluded.')
      }

      targetKeys = targetKeys.filter((id) => {
        const u = allProfiles.find((p) => p.id === id)
        if (!u || u.role === 'super_admin' || id === currentProfile.id) return false
        if (!isSuperAdmin && u.role === 'admin') return false
        return true
      })

      if (!targetKeys.length) {
        alert('No eligible accounts available to block.')
        return
      }
    }

    task.run(async () => {
      await unwrap(db.from('profiles').update({ status }).in('id', targetKeys))
      setSelectedIds([])
      d.reload()
    }, `Updated ${targetKeys.length} user(s) to ${status}`)
  }

  async function batchUpdateRole(keys: string[], role: UserRole) {
    if (!keys.length) return
    if (keys.includes(currentProfile.id) && role !== 'super_admin' && counts.super_admin <= 1) {
      alert('Cannot demote your own account when modifying roles.')
      return
    }
    task.run(async () => {
      await unwrap(db.from('profiles').update({ role }).in('id', keys))
      setSelectedIds([])
      d.reload()
    }, `Assigned role ${roleLabels[role]} to ${keys.length} user(s)`)
  }

  return (
    <>
      <Title kicker="System Governance" title="User Role Management">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="button"
            onClick={() => setCreatingUser(true)}
            style={{
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 13,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <UserPlus size={15} /> Create User
          </button>
          <button
            type="button"
            className="button"
            onClick={() => setShowRoleInfo(!showRoleInfo)}
            style={{ fontSize: 13 }}
          >
            {showRoleInfo ? 'Hide Role Permissions' : 'Role Permissions & Paths'}
          </button>
        </div>
      </Title>

      <Feedback error={task.error} busy={task.busy} />

      {/* Role Metrics */}
      <div
        className="metrics"
        style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', marginBottom: 20 }}
      >
        <div className="metric">
          <small>Total Users</small>
          <b>{counts.total}</b>
        </div>
        <div className="metric" style={{ borderLeft: '3px solid #7c3aed' }}>
          <small>Super Admins</small>
          <b style={{ color: '#7c3aed' }}>{counts.super_admin}</b>
        </div>
        <div className="metric" style={{ borderLeft: '3px solid #2563eb' }}>
          <small>Administrators</small>
          <b style={{ color: '#2563eb' }}>{counts.admin}</b>
        </div>
        <div className="metric" style={{ borderLeft: '3px solid #059669' }}>
          <small>Faculty (Authors)</small>
          <b style={{ color: '#059669' }}>{counts.content_author}</b>
        </div>
        <div className="metric" style={{ borderLeft: '3px solid #64748b' }}>
          <small>Students</small>
          <b style={{ color: '#64748b' }}>{counts.student}</b>
        </div>
      </div>

      {/* Role Information Card */}
      {showRoleInfo && (
        <div
          className="card"
          style={{ background: 'var(--pale)', border: '1px solid var(--accent)', marginBottom: 20 }}
        >
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={18} /> Role Hierarchy, Responsibilities & Landing Redirections
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 14,
              marginTop: 12,
            }}
          >
            <div
              style={{
                background: 'var(--panel)',
                padding: 14,
                borderRadius: 8,
                border: '1px solid var(--line)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#7c3aed' }}>
                <ShieldAlert size={16} /> Super Admin
              </div>
              <p style={{ margin: '6px 0', fontSize: 13, color: 'var(--muted)' }}>
                Highest authority. Cannot be blocked or deleted. Full governance over role assignments, editing users, deleting accounts, creating users, question review, exams, and proctoring.
              </p>
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                Login Redirect: <code style={{ color: 'var(--accent)' }}>/admin</code>
              </div>
            </div>

            <div
              style={{
                background: 'var(--panel)',
                padding: 14,
                borderRadius: 8,
                border: '1px solid var(--line)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#2563eb' }}>
                <UserCheck size={16} /> Administrator
              </div>
              <p style={{ margin: '6px 0', fontSize: 13, color: 'var(--muted)' }}>
                Manages test papers, question bank, schedules, proctoring violations, and student registrations. Can be blocked or deleted by Super Admin.
              </p>
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                Login Redirect: <code style={{ color: 'var(--accent)' }}>/admin</code>
              </div>
            </div>

            <div
              style={{
                background: 'var(--panel)',
                padding: 14,
                borderRadius: 8,
                border: '1px solid var(--line)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#059669' }}>
                <PenTool size={16} /> Faculty (Content Author)
              </div>
              <p style={{ margin: '6px 0', fontSize: 13, color: 'var(--muted)' }}>
                Drafts and submits original questions and explanations to the bank for administrator review and approval.
              </p>
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                Login Redirect: <code style={{ color: 'var(--accent)' }}>/content_author</code>
              </div>
            </div>

            <div
              style={{
                background: 'var(--panel)',
                padding: 14,
                borderRadius: 8,
                border: '1px solid var(--line)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#334155' }}>
                <GraduationCap size={16} /> Student
              </div>
              <p style={{ margin: '6px 0', fontSize: 13, color: 'var(--muted)' }}>
                Takes mock demo tests and assigned computer-based examinations, monitors timers, views score cards and ranks.
              </p>
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                Login Redirect: <code style={{ color: 'var(--accent)' }}>/student</code>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter and Action Toolbar */}
      <div
        className="card tools"
        style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <input
          aria-label="Search users"
          placeholder="Search name, email, roll no, or phone..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 2, minWidth: 200 }}
        />
        <select
          aria-label="Filter by role"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          style={{ minWidth: 150 }}
        >
          <option value="all">All Roles ({counts.total})</option>
          <option value="super_admin">Super Admins ({counts.super_admin})</option>
          <option value="admin">Administrators ({counts.admin})</option>
          <option value="content_author">Faculty Authors ({counts.content_author})</option>
          <option value="student">Students ({counts.student})</option>
        </select>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ minWidth: 140 }}
        >
          <option value="all">All Statuses</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending ({counts.pending})</option>
          <option value="rejected">Rejected</option>
          <option value="blocked">Blocked</option>
        </select>

        {selectedIds.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              disabled={task.busy}
              onClick={() => batchUpdateStatus(selectedIds, 'approved')}
            >
              Approve ({selectedIds.length})
            </button>
            <button
              type="button"
              disabled={task.busy}
              onClick={() => batchUpdateStatus(selectedIds, 'blocked')}
              style={{ color: '#ef4444' }}
            >
              Block ({selectedIds.length})
            </button>
            {isSuperAdmin && (
              <select
                aria-label="Batch role change"
                onChange={(e) => {
                  if (e.target.value) {
                    batchUpdateRole(selectedIds, e.target.value as UserRole)
                    e.target.value = ''
                  }
                }}
                defaultValue=""
                style={{ padding: '6px 10px', fontSize: 13 }}
              >
                <option value="" disabled>Set Role for Selected...</option>
                <option value="student">Make Student</option>
                <option value="content_author">Make Faculty Author</option>
                <option value="admin">Make Administrator</option>
                <option value="super_admin">Make Super Admin</option>
              </select>
            )}
          </div>
        )}
      </div>

      {/* Users Table */}
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  aria-label="Select all matching users"
                  checked={
                    filtered.length > 0 &&
                    filtered.every((p) => selectedIds.includes(p.id))
                  }
                  onChange={(e) =>
                    setSelectedIds(e.target.checked ? filtered.map((p) => p.id) : [])
                  }
                />
              </th>
              <th>User Details</th>
              <th>Identifier & Contact</th>
              <th>Current Role</th>
              <th>Account Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!filtered.length && (
              <tr>
                <td
                  colSpan={6}
                  style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--muted)' }}
                >
                  No users found matching your filters.
                </td>
              </tr>
            )}
            {filtered.map((user) => {
              const isSelf = user.id === currentProfile.id
              const isSuperAdminUser = user.role === 'super_admin'
              const isAdminUser = user.role === 'admin'
              const rStyle = roleColors[user.role] || roleColors.student
              const sStyle = statusColors[user.status] || statusColors.pending

              // Status management permissions
              const canChangeStatus =
                !isSelf &&
                (isSuperAdmin || (!isSuperAdminUser && !isAdminUser))

              // Edit / Delete permissions
              const canEditUser =
                isSelf ||
                isSuperAdmin ||
                (!isSuperAdminUser && !isAdminUser)

              const canDeleteUser =
                !isSelf &&
                !isSuperAdminUser &&
                (isSuperAdmin || !isAdminUser)

              return (
                <tr key={user.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${user.full_name}`}
                      checked={selectedIds.includes(user.id)}
                      onChange={(e) =>
                        setSelectedIds((prev) =>
                          e.target.checked
                            ? [...prev, user.id]
                            : prev.filter((id) => id !== user.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 650, fontSize: 14 }}>
                      {user.full_name}{' '}
                      {isSelf && (
                        <small style={{ display: 'inline', color: 'var(--accent)' }}>
                          (You)
                        </small>
                      )}
                    </div>
                    <small style={{ color: 'var(--muted)' }}>{user.email}</small>
                  </td>
                  <td>
                    <div>
                      <code>{user.roll_no}</code>
                    </div>
                    <small style={{ color: 'var(--muted)' }}>{user.phone || '—'}</small>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 650,
                          padding: '3px 8px',
                          borderRadius: 6,
                          backgroundColor: rStyle.bg,
                          color: rStyle.text,
                          border: `1px solid ${rStyle.border}`,
                        }}
                      >
                        {roleLabels[user.role] || user.role}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 4,
                        textTransform: 'capitalize',
                        backgroundColor: sStyle.bg,
                        color: sStyle.text,
                      }}
                    >
                      {user.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      {/* Change Role Selector */}
                      <select
                        aria-label={`Change role for ${user.full_name}`}
                        value={user.role}
                        disabled={task.busy || (!isSuperAdmin && (user.role === 'admin' || user.role === 'super_admin'))}
                        onChange={(e) => updateUserRole(user.id, e.target.value as UserRole)}
                        style={{
                          padding: '4px 6px',
                          fontSize: 11,
                          borderRadius: 6,
                          borderColor: 'var(--line)',
                          maxWidth: 110,
                        }}
                      >
                        <option value="student">Student</option>
                        <option value="content_author">Faculty</option>
                        <option value="admin">Admin</option>
                        {isSuperAdmin && <option value="super_admin">Super Admin</option>}
                      </select>

                      {/* Change Status Selector */}
                      {(() => {
                        const isTargetSuperAdmin = user.role === 'super_admin'
                        const isTargetAdmin = user.role === 'admin'
                        const canModify =
                          !isSelf &&
                          (isSuperAdmin || (!isTargetSuperAdmin && !isTargetAdmin))

                        return (
                          <select
                            aria-label={`Change status for ${user.full_name}`}
                            value={user.status}
                            disabled={task.busy || !canModify}
                            onChange={(e) => updateUserStatus(user.id, e.target.value as Profile['status'])}
                            title={
                              isSelf
                                ? 'Cannot modify your own status'
                                : !isSuperAdmin && (isTargetAdmin || isTargetSuperAdmin)
                                  ? 'Only Super Administrators can modify Admin status'
                                  : undefined
                            }
                            style={{
                              padding: '4px 6px',
                              fontSize: 11,
                              borderRadius: 6,
                              borderColor: 'var(--line)',
                              cursor: canModify ? 'pointer' : 'not-allowed',
                              opacity: canModify ? 1 : 0.6,
                              maxWidth: 95,
                            }}
                          >
                            <option value="approved">Approved</option>
                            <option value="pending">Pending</option>
                            <option value="rejected">Rejected</option>
                            {!isTargetSuperAdmin && <option value="blocked">Blocked</option>}
                          </select>
                        )
                      })()}

                      {/* Edit Button */}
                      <button
                        type="button"
                        className="button"
                        style={{ padding: '4px 8px', fontSize: 11, height: 26 }}
                        title={canEditUser ? 'Edit user profile' : 'Permission required to edit this account'}
                        disabled={task.busy || !canEditUser}
                        onClick={() => startEdit(user)}
                      >
                        <Pencil size={11} /> Edit
                      </button>

                      {/* Delete Button */}
                      <button
                        type="button"
                        className="button"
                        style={{
                          padding: '4px 8px',
                          fontSize: 11,
                          height: 26,
                          color: canDeleteUser ? '#dc2626' : undefined,
                          borderColor: canDeleteUser ? '#fca5a5' : undefined,
                        }}
                        title={
                          isSelf
                            ? 'Cannot delete your own account'
                            : isSuperAdminUser
                              ? 'Super Administrator accounts cannot be deleted'
                              : !isSuperAdmin && isAdminUser
                                ? 'Only Super Administrators can delete Admin accounts'
                                : 'Permanently delete this user account'
                        }
                        disabled={task.busy || !canDeleteUser}
                        onClick={() => setDeletingUser(user)}
                      >
                        <Trash2 size={11} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Create User Modal */}
      {creatingUser && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreatingUser(false)
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 540,
              margin: 0,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 14,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 18,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <UserPlus size={18} /> Create New User Account
              </h2>
              <button
                type="button"
                onClick={() => setCreatingUser(false)}
                style={{
                  padding: 4,
                  border: 0,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--muted)' }}>
              Add a new user directly to the platform with an assigned role and credentials.
            </p>

            <form onSubmit={handleCreateUser} style={{ display: 'grid', gap: 12 }}>
              <label>
                Full Name
                <input
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={createForm.full_name}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, full_name: e.target.value }))
                  }
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12 }}>
                <label>
                  Email Address
                  <input
                    required
                    type="email"
                    placeholder="user@example.com"
                    value={createForm.email}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, email: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Password (min 8 chars)
                  <input
                    required
                    type="text"
                    placeholder="Initial password"
                    minLength={8}
                    value={createForm.password}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, password: e.target.value }))
                    }
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label>
                  Roll Number / Identifier
                  <input
                    required
                    placeholder="e.g. 0820CS181025 or ADM-02"
                    value={createForm.roll_no}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, roll_no: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Phone Number
                  <input
                    required
                    type="tel"
                    placeholder="+91 9876543210"
                    value={createForm.phone}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, phone: e.target.value }))
                    }
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label>
                  Initial Role
                  <select
                    value={createForm.role}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, role: e.target.value as UserRole }))
                    }
                  >
                    <option value="student">Student</option>
                    <option value="content_author">Faculty Author</option>
                    {isSuperAdmin && <option value="admin">Administrator</option>}
                    {isSuperAdmin && <option value="super_admin">Super Admin</option>}
                  </select>
                </label>

                <label>
                  Account Status
                  <select
                    value={createForm.status}
                    onChange={(e) =>
                      setCreateForm((f) => ({
                        ...f,
                        status: e.target.value as Profile['status'],
                      }))
                    }
                  >
                    <option value="approved">Approved (Active)</option>
                    <option value="pending">Pending Review</option>
                    <option value="rejected">Rejected</option>
                    {createForm.role !== 'super_admin' && (
                      <option value="blocked">Blocked</option>
                    )}
                  </select>
                </label>
              </div>

              <div className="actions end" style={{ marginTop: 16 }}>
                <button type="button" onClick={() => setCreatingUser(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={task.busy}
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingUser(null)
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 520,
              margin: 0,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 14,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 18,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Pencil size={18} /> Edit User Account
              </h2>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                style={{
                  padding: 4,
                  border: 0,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--muted)' }}>
              Editing details for <strong>{editingUser.email}</strong>
            </p>

            <form onSubmit={saveEdit} style={{ display: 'grid', gap: 12 }}>
              <label>
                Full Name
                <input
                  required
                  value={editForm.full_name}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, full_name: e.target.value }))
                  }
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label>
                  Roll Number / Identifier
                  <input
                    required
                    value={editForm.roll_no}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, roll_no: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Phone Number
                  <input
                    type="tel"
                    value={editForm.phone}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, phone: e.target.value }))
                    }
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label>
                  User Role
                  <select
                    value={editForm.role}
                    disabled={
                      !isSuperAdmin &&
                      (editingUser.role === 'admin' || editingUser.role === 'super_admin')
                    }
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, role: e.target.value as UserRole }))
                    }
                  >
                    <option value="student">Student</option>
                    <option value="content_author">Faculty Author</option>
                    <option value="admin">Administrator</option>
                    {isSuperAdmin && <option value="super_admin">Super Admin</option>}
                  </select>
                </label>

                <label>
                  Account Status
                  <select
                    value={editForm.status}
                    disabled={
                      editingUser.id === currentProfile.id ||
                      (!isSuperAdmin && editingUser.role === 'admin')
                    }
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        status: e.target.value as Profile['status'],
                      }))
                    }
                  >
                    <option value="approved">Approved</option>
                    <option value="pending">Pending</option>
                    <option value="rejected">Rejected</option>
                    {editForm.role !== 'super_admin' &&
                      editingUser.role !== 'super_admin' && (
                        <option value="blocked">Blocked</option>
                      )}
                  </select>
                </label>
              </div>

              <div className="actions end" style={{ marginTop: 16 }}>
                <button type="button" onClick={() => setEditingUser(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={task.busy}
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {deletingUser && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeletingUser(null)
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 460,
              margin: 0,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 12,
                color: '#dc2626',
              }}
            >
              <AlertTriangle size={24} />
              <h2 style={{ margin: 0, fontSize: 18, color: '#dc2626' }}>
                Permanently Delete Account?
              </h2>
            </div>

            <p style={{ margin: '0 0 14px', fontSize: 14 }}>
              Are you sure you want to delete the account for{' '}
              <strong>{deletingUser.full_name}</strong> (<code>{deletingUser.email}</code>)?
            </p>

            <p
              style={{
                margin: '0 0 18px',
                fontSize: 13,
                color: 'var(--muted)',
                background: '#fef2f2',
                padding: 10,
                borderRadius: 6,
                border: '1px solid #fecaca',
              }}
            >
              ⚠️ This action cannot be undone. All associated candidate test attempts, score history, and permissions will be permanently removed.
            </p>

            <div className="actions end" style={{ gap: 10 }}>
              <button
                type="button"
                onClick={() => setDeletingUser(null)}
                disabled={task.busy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={task.busy}
                style={{
                  backgroundColor: '#dc2626',
                  color: '#fff',
                  borderColor: '#dc2626',
                }}
              >
                Yes, Delete Account
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
