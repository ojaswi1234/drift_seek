// lib/mailer.ts
import nodemailer from 'nodemailer';

// Create the transporter once
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

interface EmailPayload {
  to: string;
  subject: string;
  text: string;
}

// Export a clean, reusable function
export async function sendEmailAlert({ to, subject, text }: EmailPayload) {
  try {
    const info = await transporter.sendMail({
      from: `"DriftSeeker Watchtower" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
    });
    console.log(`Alert sent successfully to ${to} (Message ID: ${info.messageId})`);
    return { success: true };
  } catch (error) {
    console.error(`Failed to send email to ${to}:`, error);
    throw error;
  }
}