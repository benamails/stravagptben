import type { NextRequest } from 'next/server';
import { StravaRedisService } from '@/lib/strava-redis-vercel';
import type { StravaActivity, ImportResult } from '@/types/strava';

export async function POST(request: NextRequest) {
  try {
    const { activities, batchSize = 50 } = await request.json();

    if (!activities || !Array.isArray(activities)) {
      return Response.json({ 
        error: 'Activities array required in request body' 
      }, { status: 400 });
    }

    const maxActivities = 500;
    const activitiesToProcess = activities.slice(0, maxActivities);

    await StravaRedisService.setImportStatus('processing', 0);

    let processed = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    for (let i = 0; i < activitiesToProcess.length; i += batchSize) {
      const batch = activitiesToProcess.slice(i, i + batchSize);
      
      const promises = batch.map(async (activity: StravaActivity) => {
        try {
          await StravaRedisService.saveActivity(activity);
          return { success: true, id: activity.id };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          errorDetails.push(`Activity ${activity.id}: ${errorMsg}`);
          return { success: false, id: activity.id, error: errorMsg };
        }
      });

      const results = await Promise.all(promises);
      processed += results.filter(r => r.success).length;
      errors += results.filter(r => !r.success).length;

      const progress = Math.round((processed / activitiesToProcess.length) * 100);
      await StravaRedisService.setImportStatus('processing', progress);
    }

    await StravaRedisService.setImportStatus('completed', 100);
    await StravaRedisService.updateLastSync();

    return Response.json({
      message: 'Import completed',
      processed,
      errors,
      total: activitiesToProcess.length,
      truncated: activities.length > maxActivities,
      ...(errorDetails.length > 0 && { errorDetails: errorDetails.slice(0, 10) })
    });

  } catch (error) {
    console.error('Import error:', error);
    await StravaRedisService.setImportStatus('error', 0);
    
    return Response.json({ 
      error: 'Import failed', 
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
