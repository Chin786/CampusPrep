export interface EmailPayload {
  to: string
  subject: string
  html?: string
  text?: string
}

export async function sendEmail(
  payload: EmailPayload,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || 'Failed to send email')
    }

    return { success: true }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err)
    console.warn('[Email Service Warning]:', error)
    return { success: false, error }
  }
}
