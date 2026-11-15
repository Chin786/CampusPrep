import type { VercelRequest, VercelResponse } from '@vercel/node'
import nodemailer from 'nodemailer'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow health check / ping
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ready',
      message: 'Email service via Nodemailer is configured.',
      hasCredentials: Boolean(process.env.SMTP_USER && process.env.SMTP_PASS),
    })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' })
  }

  const { to, subject, html, text } = req.body || {}

  if (!to || !subject || (!html && !text)) {
    return res.status(400).json({
      error: 'Missing required fields: "to", "subject", and "html" or "text".',
    })
  }

  const host = process.env.SMTP_HOST || 'smtp.gmail.com'
  const port = parseInt(process.env.SMTP_PORT || '465', 10)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const secure =
    process.env.SMTP_SECURE !== undefined
      ? process.env.SMTP_SECURE === 'true'
      : port === 465

  if (!user || !pass) {
    return res.status(500).json({
      error:
        'SMTP credentials not configured. Please set SMTP_USER and SMTP_PASS in your environment variables.',
    })
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    })

    const fromAddress =
      process.env.SMTP_FROM || `"CampusPrep CBT" <${user}>`

    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      text: text || undefined,
      html: html || undefined,
    })

    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
    })
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : 'Failed to send email'
    console.error('[Nodemailer Error]:', errorMessage)
    return res.status(500).json({
      error: errorMessage,
    })
  }
}
