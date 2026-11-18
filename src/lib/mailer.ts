import nodemailer from 'nodemailer'

export type MailAttachment = {
  filename: string
  content: Buffer
  contentType?: string
}

export type MailMessage = {
  to: string
  subject: string
  text: string
  attachments?: MailAttachment[]
}

function buildTransport() {
  const host = process.env.SMTP_HOST
  if (!host) throw new Error('SMTP belum dikonfigurasi')

  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  return {
    transport: nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass } : undefined,
      // Paksa IPv4 untuk menghindari delay atau ECONNREFUSED pada jaringan IPv6
      family: 4,
    } as any),
    from: process.env.SMTP_FROM ?? user ?? 'no-reply@inventaris.local',
  }
}

export async function sendEmail(message: MailMessage): Promise<void> {
  // 1. Jika ada RESEND_API_KEY, gunakan HTTP API (Port 443 HTTPS - 100% Lolos di Render / Vercel)
  const resendApiKey = process.env.RESEND_API_KEY
  if (resendApiKey) {
    const from = process.env.RESEND_FROM || 'Inventaris Gudang <onboarding@resend.dev>'
    const attachments = message.attachments?.map((att) => ({
      filename: att.filename,
      content: att.content.toString('base64'),
    }))

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        attachments,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { message?: string }
      throw new Error(`Resend API Error (${res.status}): ${err.message || res.statusText}`)
    }
    return
  }

  // 2. Fallback ke SMTP biasa (untuk pengembangan di Lokal)
  const { transport, from } = buildTransport()
  await transport.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    attachments: message.attachments,
  })
}
