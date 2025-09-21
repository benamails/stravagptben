import { NextRequest, NextResponse } from 'next/server';
import { initializeLastActivityTimestamp, getLastActivityTimestamp } from '@/lib/activity-processor';

export async function POST() {
  try {
    const beforeTimestamp = await getLastActivityTimestamp();
    await initializeLastActivityTimestamp();
    const afterTimestamp = await getLastActivityTimestamp();
    
    return NextResponse.json({
      success: true,
      before: beforeTimestamp ? new Date(beforeTimestamp).toISOString() : null,
      after: afterTimestamp ? new Date(afterTimestamp).toISOString() : null,
      initialized: !beforeTimestamp && !!afterTimestamp
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
