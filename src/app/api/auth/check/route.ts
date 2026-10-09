import { NextRequest, NextResponse } from 'next/server';
import { verifyUserSessionToken, USER_COOKIE_NAME } from '@/lib/userAuth';

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(USER_COOKIE_NAME);
  const isValid = verifyUserSessionToken(cookie?.value);

  return NextResponse.json({ authenticated: isValid });
}
