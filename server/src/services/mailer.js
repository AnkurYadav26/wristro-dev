import nodemailer from 'nodemailer';
import env from '../config/env.js';

let transport;
function getTransport() {
  if (transport) return transport;
  transport = env.SMTP_HOST
    ? nodemailer.createTransport({
        host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      })
    : null; // dev fallback: log to console
  return transport;
}

export async function sendMail({ to, subject, text, html }) {
  const t = getTransport();
  if (!t) {
    console.log(`\n[mail:dev] To: ${to}\n[mail:dev] Subject: ${subject}\n[mail:dev] ${text}\n`);
    return { dev: true };
  }
  return t.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
}

const PURPOSE_COPY = {
  verify_email: { subject: 'Verify your WRISTORA account', lead: 'Use this code to verify your email address' },
  reset_password: { subject: 'Reset your WRISTORA password', lead: 'Use this code to reset your password' },
  admin_login: { subject: 'Your WRISTORA admin sign-in code', lead: 'Use this code to finish signing in to the WRISTORA admin panel' },
};
export function sendOtpEmail(to, code, purpose, ttlMinutes = 10) {
  const c = PURPOSE_COPY[purpose];
  const text = `${c.lead}: ${code}\n\nThis code expires in ${ttlMinutes} minutes. If you did not request it, you can ignore this email. WRISTORA staff will never ask you for this code.`;
  const html = `<p>${c.lead}:</p><p style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</p><p>This code expires in ${ttlMinutes} minutes. If you did not request it, ignore this email. WRISTORA staff will never ask for this code.</p>`;
  return sendMail({ to, subject: c.subject, text, html });
}

/**
 * SMS provider interface (Phase 1 ships email OTP only).
 * To add MSG91/Twilio: implement `send(mobile, message)` here and wire it into otpService.
 * MSG91 requires DLT registration + approved templates before it will deliver in India.
 */
export const smsProvider = {
  async send() { throw new Error('SMS provider not configured. Implement MSG91/Twilio after DLT registration.'); },
};
