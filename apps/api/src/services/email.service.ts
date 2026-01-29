import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// Email templates
type EmailTemplate = 'verify-email' | 'password-reset' | 'new-login' | 'mfa-enabled' | 'password-changed';

interface EmailData {
  to: string;
  template: EmailTemplate;
  data: Record<string, string>;
}

interface TemplateContent {
  subject: string;
  html: string;
  text: string;
}

// Template definitions
const templates: Record<EmailTemplate, (data: Record<string, string>) => TemplateContent> = {
  'verify-email': (data) => ({
    subject: 'Verify your Control Vector email',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; padding: 20px 0; border-bottom: 2px solid #6366f1; }
            .content { padding: 30px 0; }
            .button { display: inline-block; padding: 12px 24px; background: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; }
            .footer { padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
            .code { font-family: monospace; font-size: 24px; letter-spacing: 4px; background: #f3f4f6; padding: 10px 20px; border-radius: 4px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="color: #6366f1; margin: 0;">Control Vector</h1>
            </div>
            <div class="content">
              <h2>Verify your email address</h2>
              <p>Hi ${data.username},</p>
              <p>Thanks for signing up! Please verify your email address by clicking the button below:</p>
              <p style="text-align: center; padding: 20px 0;">
                <a href="${data.verifyUrl}" class="button">Verify Email</a>
              </p>
              <p>Or use this verification code:</p>
              <p style="text-align: center;">
                <span class="code">${data.token}</span>
              </p>
              <p>This link expires in 24 hours.</p>
            </div>
            <div class="footer">
              <p>If you didn't create an account, you can safely ignore this email.</p>
              <p>&copy; ${new Date().getFullYear()} Control Vector</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `
Control Vector - Verify Your Email

Hi ${data.username},

Thanks for signing up! Please verify your email address by visiting this link:

${data.verifyUrl}

Or use this verification code: ${data.token}

This link expires in 24 hours.

If you didn't create an account, you can safely ignore this email.
    `.trim(),
  }),

  'password-reset': (data) => ({
    subject: 'Reset your Control Vector password',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; padding: 20px 0; border-bottom: 2px solid #6366f1; }
            .content { padding: 30px 0; }
            .button { display: inline-block; padding: 12px 24px; background: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; }
            .footer { padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
            .warning { background: #fef3c7; border: 1px solid #f59e0b; padding: 12px; border-radius: 6px; color: #92400e; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="color: #6366f1; margin: 0;">Control Vector</h1>
            </div>
            <div class="content">
              <h2>Reset your password</h2>
              <p>Hi ${data.username},</p>
              <p>We received a request to reset your password. Click the button below to create a new password:</p>
              <p style="text-align: center; padding: 20px 0;">
                <a href="${data.resetUrl}" class="button">Reset Password</a>
              </p>
              <p>This link expires in 1 hour.</p>
              <div class="warning">
                <strong>Didn't request this?</strong> Someone may have entered your email by mistake. If you didn't request a password reset, you can safely ignore this email.
              </div>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} Control Vector</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `
Control Vector - Reset Your Password

Hi ${data.username},

We received a request to reset your password. Visit this link to create a new password:

${data.resetUrl}

This link expires in 1 hour.

If you didn't request this, you can safely ignore this email.
    `.trim(),
  }),

  'new-login': (data) => ({
    subject: 'New sign-in to your Control Vector account',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; padding: 20px 0; border-bottom: 2px solid #6366f1; }
            .content { padding: 30px 0; }
            .details { background: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0; }
            .details dt { font-weight: 600; color: #374151; }
            .details dd { margin: 4px 0 12px 0; color: #6b7280; }
            .button { display: inline-block; padding: 12px 24px; background: #dc2626; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; }
            .footer { padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="color: #6366f1; margin: 0;">Control Vector</h1>
            </div>
            <div class="content">
              <h2>New sign-in detected</h2>
              <p>Hi ${data.username},</p>
              <p>We detected a new sign-in to your account:</p>
              <dl class="details">
                <dt>Time</dt>
                <dd>${data.time}</dd>
                <dt>Device</dt>
                <dd>${data.device}</dd>
                <dt>Location</dt>
                <dd>${data.location}</dd>
              </dl>
              <p>If this was you, no action is needed.</p>
              <p>If this wasn't you, secure your account immediately:</p>
              <p style="text-align: center; padding: 20px 0;">
                <a href="${data.securityUrl}" class="button">Secure My Account</a>
              </p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} Control Vector</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `
Control Vector - New Sign-in Detected

Hi ${data.username},

We detected a new sign-in to your account:

Time: ${data.time}
Device: ${data.device}
Location: ${data.location}

If this was you, no action is needed.

If this wasn't you, secure your account immediately: ${data.securityUrl}
    `.trim(),
  }),

  'mfa-enabled': (data) => ({
    subject: 'Two-factor authentication enabled',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; padding: 20px 0; border-bottom: 2px solid #6366f1; }
            .content { padding: 30px 0; }
            .success { background: #d1fae5; border: 1px solid #10b981; padding: 12px; border-radius: 6px; color: #065f46; text-align: center; }
            .footer { padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="color: #6366f1; margin: 0;">Control Vector</h1>
            </div>
            <div class="content">
              <h2>Two-factor authentication enabled</h2>
              <p>Hi ${data.username},</p>
              <div class="success">
                <strong>Your account is now more secure!</strong>
              </div>
              <p style="margin-top: 20px;">You've successfully enabled two-factor authentication using ${data.method}.</p>
              <p>From now on, you'll need to provide a verification code when signing in.</p>
              <p><strong>Important:</strong> Make sure you've saved your backup codes in a safe place. You'll need them if you lose access to your ${data.method}.</p>
            </div>
            <div class="footer">
              <p>If you didn't make this change, contact support immediately.</p>
              <p>&copy; ${new Date().getFullYear()} Control Vector</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `
Control Vector - Two-Factor Authentication Enabled

Hi ${data.username},

Your account is now more secure!

You've successfully enabled two-factor authentication using ${data.method}.

From now on, you'll need to provide a verification code when signing in.

Important: Make sure you've saved your backup codes in a safe place.

If you didn't make this change, contact support immediately.
    `.trim(),
  }),

  'password-changed': (data) => ({
    subject: 'Your Control Vector password was changed',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; padding: 20px 0; border-bottom: 2px solid #6366f1; }
            .content { padding: 30px 0; }
            .warning { background: #fef3c7; border: 1px solid #f59e0b; padding: 12px; border-radius: 6px; color: #92400e; }
            .button { display: inline-block; padding: 12px 24px; background: #dc2626; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; }
            .footer { padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="color: #6366f1; margin: 0;">Control Vector</h1>
            </div>
            <div class="content">
              <h2>Password changed</h2>
              <p>Hi ${data.username},</p>
              <p>Your password was successfully changed on ${data.time}.</p>
              <div class="warning">
                <strong>Didn't make this change?</strong>
                <p style="margin: 8px 0 0 0;">If you didn't change your password, your account may be compromised. Reset your password immediately:</p>
              </div>
              <p style="text-align: center; padding: 20px 0;">
                <a href="${data.resetUrl}" class="button">Reset Password</a>
              </p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} Control Vector</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `
Control Vector - Password Changed

Hi ${data.username},

Your password was successfully changed on ${data.time}.

If you didn't make this change, your account may be compromised.
Reset your password immediately: ${data.resetUrl}
    `.trim(),
  }),
};

// Email transport
let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  // Development mode - just log emails
  if (env.NODE_ENV === 'development' && !env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      streamTransport: true,
      newline: 'unix',
    });
    return transporter;
  }

  // Production mode - use SMTP
  if (!env.SMTP_HOST || !env.SMTP_PORT) {
    throw new Error('SMTP configuration missing');
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER && env.SMTP_PASS ? {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    } : undefined,
  });

  return transporter;
}

// Send email
export async function sendEmail(options: EmailData): Promise<boolean> {
  try {
    const template = templates[options.template];
    if (!template) {
      logger.error('general', 'Unknown email template', { template: options.template });
      return false;
    }

    const content = template(options.data);
    const transport = getTransporter();

    const fromAddress = env.EMAIL_FROM || 'noreply@controlfab.ai';

    const info = await transport.sendMail({
      from: `"Control Fabric" <${fromAddress}>`,
      to: options.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });

    // In development, log the email content
    if (env.NODE_ENV === 'development') {
      logger.info('general', 'Email sent (dev mode)', {
        to: options.to,
        subject: content.subject,
        messageId: info.messageId,
      });
      // Log the text version for easy reading
      logger.debug('general', 'Email content', { text: content.text });
    } else {
      logger.info('general', 'Email sent', {
        to: options.to,
        subject: content.subject,
        messageId: info.messageId,
      });
    }

    return true;
  } catch (error) {
    logger.error('general', 'Failed to send email', error as Error);
    return false;
  }
}

// Convenience functions
export async function sendVerificationEmail(
  to: string,
  username: string,
  token: string,
): Promise<boolean> {
  const verifyUrl = `${env.APP_URL}/verify-email?token=${token}`;
  return sendEmail({
    to,
    template: 'verify-email',
    data: { username, token, verifyUrl },
  });
}

export async function sendPasswordResetEmail(
  to: string,
  username: string,
  token: string,
): Promise<boolean> {
  const resetUrl = `${env.APP_URL}/reset-password?token=${token}`;
  return sendEmail({
    to,
    template: 'password-reset',
    data: { username, resetUrl },
  });
}

export async function sendNewLoginEmail(
  to: string,
  username: string,
  device: string,
  location: string,
): Promise<boolean> {
  const time = new Date().toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
  });
  const securityUrl = `${env.APP_URL}/settings/security`;
  return sendEmail({
    to,
    template: 'new-login',
    data: { username, time, device, location, securityUrl },
  });
}

export async function sendMfaEnabledEmail(
  to: string,
  username: string,
  method: string,
): Promise<boolean> {
  return sendEmail({
    to,
    template: 'mfa-enabled',
    data: { username, method },
  });
}

export async function sendPasswordChangedEmail(
  to: string,
  username: string,
): Promise<boolean> {
  const time = new Date().toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
  });
  const resetUrl = `${env.APP_URL}/forgot-password`;
  return sendEmail({
    to,
    template: 'password-changed',
    data: { username, time, resetUrl },
  });
}
