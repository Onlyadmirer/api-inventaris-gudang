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
    }),
    from: process.env.SMTP_FROM ?? user ?? 'no-reply@inventaris.local',
  }
}

export async function sendEmail(message: MailMessage): Promise<void> {
  const { transport, from } = buildTransport()
  await transport.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    attachments: message.attachments,
  })
}
