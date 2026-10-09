import { NextRequest, NextResponse } from 'next/server';
import {
  verifyUserPassword,
  createUserSessionToken,
  checkUserRateLimit,
  recordUserFailedAttempt,
  resetUserRateLimit,
  verifyUserSessionToken,
  USER_COOKIE_NAME,
} from '@/lib/userAuth';

export async function POST(req: NextRequest) {
  // Extract client IP for rate limiting
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '127.0.0.1';

  // Check brute-force status
  const rateLimit = checkUserRateLimit(ip);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'too_many_attempts',
        message: `試行回数の上限に達しました。${Math.ceil((rateLimit.retryAfterSec || 60) / 60)}分後に再試行してください。`,
        retryAfterSec: rateLimit.retryAfterSec,
      },
      { status: 429 }
    );
  }

  let body: { password?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json', message: '無効なリクエストデータです。' }, { status: 400 });
  }

  const candidate = body.password || body.pin;
  if (!candidate || typeof candidate !== 'string') {
    return NextResponse.json({ error: 'password_required', message: 'パスワードを入力してください。' }, { status: 400 });
  }

  const isValid = verifyUserPassword(candidate);
  if (!isValid) {
    const failureResult = recordUserFailedAttempt(ip);
    return NextResponse.json(
      {
        error: 'invalid_credentials',
        message: failureResult.locked
          ? '試行回数上限に達したため一時的にロックされました。'
          : `パスワードが正しくありません。(残り試行回数: ${failureResult.remainingAttempts}回)`,
        remainingAttempts: failureResult.remainingAttempts,
        locked: failureResult.locked,
      },
      { status: 401 }
    );
  }

  // Success: reset rate limit and issue secure session cookie (7 days)
  resetUserRateLimit(ip);
  const token = createUserSessionToken(7);

  const isHttps = req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl.protocol === 'https:';

  const response = NextResponse.json({ success: true, message: '認証に成功しました。' });
  response.cookies.set({
    name: USER_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600, // 7 days
    path: '/',
  });


  return response;
}

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(USER_COOKIE_NAME);
  const isValid = verifyUserSessionToken(cookie?.value);

  return NextResponse.json({ authenticated: isValid });
}

export async function DELETE() {
  const response = NextResponse.json({ success: true, message: 'ログアウトしました。' });
  response.cookies.set({
    name: USER_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  return response;
}
