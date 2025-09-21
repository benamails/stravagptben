// app/api/auth/strava/route.ts

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id') || '14060676';
  
  // URL d'autorisation Strava
  const stravaAuthUrl = new URL('https://www.strava.com/oauth/authorize');
  stravaAuthUrl.searchParams.append('client_id', process.env.STRAVA_CLIENT_ID!);
  stravaAuthUrl.searchParams.append('response_type', 'code');
  stravaAuthUrl.searchParams.append('redirect_uri', `${request.nextUrl.origin}/api/auth/strava/callback`);
  stravaAuthUrl.searchParams.append('approval_prompt', 'force');
  stravaAuthUrl.searchParams.append('scope', 'read,activity:read_all');
  stravaAuthUrl.searchParams.append('state', userId);
  
  return NextResponse.redirect(stravaAuthUrl);
}

export const dynamic = 'force-dynamic';
