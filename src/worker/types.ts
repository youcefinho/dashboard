/// <reference types="@cloudflare/workers-types" />
// ── Types partagés Worker ────────────────────────────────────

export interface Env {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  RESEND_API_KEY: string;
  WEBHOOK_SECRET: string;
  NOTIFICATION_EMAIL: string;
  ALLOWED_ORIGINS: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_PHONE_NUMBER: string;
  OPENAI_API_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  GBP_API_KEY: string;
  ANTHROPIC_API_KEY: string;
}

export interface AuthContext {
  userId: string;
  role: string;
}

export const SESSION_DURATION_HOURS = 24;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_WINDOW_HOURS = 1;
