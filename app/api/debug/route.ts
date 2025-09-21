import { NextRequest, NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    webhook_token_defined: !!process.env.STRAVA_WEBHOOK_VERIFY_TOKEN,
    webhook_token_length: process.env.STRAVA_WEBHOOK_VERIFY_TOKEN?.length || 0,
    // N'affiche que les premiers caractères pour sécurité
    webhook_token_preview: process.env.STRAVA_WEBHOOK_VERIFY_TOKEN?.substring(0, 8) + '...',
    node_env: process.env.NODE_ENV
  });
}

export const dynamic = 'force-dynamic';
