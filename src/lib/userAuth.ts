import crypto from 'crypto';

// Server-side user page password (strictly '848' by default, or configurable via env)
const SERVER_USER_PASSWORD = process.env.USER_PAGE_PASSWORD || process.env.USER_PASSWORD || '884';
const SESSION_SECRET = process.env.USER_SESSION_SECRET || 'salomon-takao-user-session-secret-key-886';

export const USER_COOKIE_NAME = 'salomon_user_session';

// In-memory rate limiting map: ip -> { attempts: number, lockedUntil: number }
interface RateLimitRecord {
  attempts: number;
  lockedUntil: number;
}
const rateLimitMap = new Map<string, RateLimitRecord>();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes lockout

export function checkUserRateLimit(ip: string): { allowed: boolean; remainingAttempts: number; retryAfterSec?: number } {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (record) {
    if (record.lockedUntil > now) {
      return {
        allowed: false,
        remainingAttempts: 0,
        retryAfterSec: Math.ceil((record.lockedUntil - now) / 1000),
      };
    } else if (record.lockedUntil > 0 && record.lockedUntil <= now) {
      rateLimitMap.delete(ip);
    }
  }

  const currentAttempts = record?.attempts || 0;
  return {
    allowed: true,
    remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - currentAttempts),
  };
}

export function recordUserFailedAttempt(ip: string): { locked: boolean; remainingAttempts: number; retryAfterSec?: number } {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { attempts: 0, lockedUntil: 0 };
  record.attempts += 1;

  if (record.attempts >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
    rateLimitMap.set(ip, record);
    return {
      locked: true,
      remainingAttempts: 0,
      retryAfterSec: Math.ceil(LOCKOUT_DURATION_MS / 1000),
    };
  }

  rateLimitMap.set(ip, record);
  return {
    locked: false,
    remainingAttempts: MAX_FAILED_ATTEMPTS - record.attempts,
  };
}

export function resetUserRateLimit(ip: string) {
  rateLimitMap.delete(ip);
}

/**
 * Constant-time password verification to prevent timing attack vulnerabilities.
 */
export function verifyUserPassword(candidatePassword: string): boolean {
  if (!candidatePassword || typeof candidatePassword !== 'string') return false;

  const target = Buffer.from(SERVER_USER_PASSWORD.trim());
  const candidate = Buffer.from(candidatePassword.trim());

  if (target.length !== candidate.length) {
    // Constant time dummy comparison
    crypto.timingSafeEqual(target, target);
    return false;
  }

  return crypto.timingSafeEqual(target, candidate);
}

/**
 * Returns a short fingerprint of the current password.
 * Embedded in the session token so that a password change
 * immediately invalidates all existing sessions.
 */
function passwordFingerprint(): string {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`pwd-fingerprint:${SERVER_USER_PASSWORD}`)
    .digest('hex')
    .slice(0, 16); // 16 hex chars is enough — not a security boundary, just a cache-buster
}

/**
 * Creates an HMAC-SHA256 signed session token for the user page.
 * The current password fingerprint is embedded so that changing
 * USER_PAGE_PASSWORD immediately invalidates all issued tokens.
 */
export function createUserSessionToken(validDays = 7): string {
  const expiresAt = Date.now() + validDays * 24 * 3600 * 1000;
  const pwdHash   = passwordFingerprint();
  // payload format: user:{expiresAt}:{pwdHash}
  const payload   = `user:${expiresAt}:${pwdHash}`;
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

/**
 * Validates the HMAC signature, expiration, and password fingerprint
 * of a user session token.
 *
 * Fails (→ forces re-login) when:
 *  - signature is invalid
 *  - token has expired
 *  - the embedded password fingerprint no longer matches the current password
 *    (i.e. the password was changed after this token was issued)
 */
export function verifyUserSessionToken(token: string | null | undefined): boolean {
  if (!token || typeof token !== 'string') return false;

  const decoded = decodeURIComponent(token);
  const lastDot = decoded.lastIndexOf('.');
  if (lastDot === -1) return false;

  const payload           = decoded.slice(0, lastDot);
  const candidateSignature = decoded.slice(lastDot + 1);

  // 1. Verify HMAC signature
  const expectedSignature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const expectedBuf   = Buffer.from(expectedSignature);
  const candidateBuf  = Buffer.from(candidateSignature);
  if (expectedBuf.length !== candidateBuf.length) return false;
  if (!crypto.timingSafeEqual(expectedBuf, candidateBuf)) return false;

  // 2. Parse payload:  user:{expiresAt}:{pwdHash}
  const parts = payload.split(':');
  if (parts.length < 3) return false; // legacy token without pwdHash — reject

  const [role, expiresStr, embeddedPwdHash] = parts;
  if (role !== 'user') return false;

  // 3. Check expiry
  const expiresAt = parseInt(expiresStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) return false;

  // 4. Check password fingerprint — if password changed, this will not match
  const currentPwdHash = passwordFingerprint();
  const embeddedBuf = Buffer.from(embeddedPwdHash, 'hex');
  const currentBuf  = Buffer.from(currentPwdHash, 'hex');
  if (embeddedBuf.length !== currentBuf.length) return false;
  if (!crypto.timingSafeEqual(embeddedBuf, currentBuf)) return false;

  return true;
}

