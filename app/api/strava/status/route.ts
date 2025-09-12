import type { NextRequest } from 'next/server';
import { StravaRedisService } from '@/lib/strava-redis-vercel';

export async function GET(request: NextRequest) {
  try {
    const importStatus = await StravaRedisService.getImportStatus();
    const lastSync = await StravaRedisService.getLastSync();
    
    return Response.json({
      importStatus: importStatus || { status: 'none', progress: 0, timestamp: new Date().toISOString() },
      lastSync,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Status check error:', error);
    return Response.json({ error: 'Failed to get status' }, { status: 500 });
  }
}
