import crypto from "node:crypto";

// Single-admin passcode gate. The passcode itself never leaves the server:
// login trades it for a signed, expiring cookie. No user table, no OAuth —
// one admin (Lucia), one secret in Railway (ADMIN_PASSCODE).
//
// Two cookies concerns handled here:
//   - The token is HMAC-signed so it can't be forged without the secret.
//   - It carries its own expiry so a leaked cookie dies after 7 days even
//     if the passcode is never rotated.

export const ADMIN_COOKIE = "lucia_admin";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function signingSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSCODE || "";
}

export function isAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSCODE);
}

function hmac(payload: string): string {
  return crypto.createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

export function verifyPasscode(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function mintSessionToken(): string {
  const payload = `admin.${Date.now() + SESSION_TTL_MS}`;
  return `${payload}.${hmac(payload)}`;
}

export function isValidSessionToken(token: string | undefined): boolean {
  if (!token || !signingSecret()) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "admin") return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = hmac(payload);
  const actual = parts[2];
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const expiresAt = Number(parts[1]);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function sessionFromRequest(req: Request): boolean {
  const header = req.headers.get("cookie") ?? "";
  for (const pair of header.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name === ADMIN_COOKIE) {
      return isValidSessionToken(decodeURIComponent(rest.join("=")));
    }
  }
  return false;
}

export function sessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${encodeURIComponent(mintSessionToken())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`;
}

export function clearedCookie(): string {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
