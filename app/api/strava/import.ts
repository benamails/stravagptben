import type { NextApiRequest, NextApiResponse } from 'next';
import { StravaRedisService } from '../../../lib/strava-redis-vercel';
import type { StravaActivity, ImportResult } from '../../../types/strava';

interface ImportRequestBody {
  activities: StravaActivity[];
  batchSize?: number;
}

interface ImportResponse {
  message: string;
  processed: number;
  errors: number;
  total: number;
  truncated: boolean;
  errorDetails?: string[];
}

interface ErrorResponse {
  error: string;
  message?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ImportResponse | ErrorResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { activities, batchSize = 50 }: ImportRequestBody = req.body;

    if (!activities || !Array.isArray(activities)) {
      return res.status(400).json({ 
        error: 'Activities array required in request body' 
      });
    }

    // Limite pour éviter les timeouts Vercel (30s max)
    const maxActivities = 500;
    const activitiesToProcess = activities.slice(0, maxActivities);

    await StravaRedisService.setImportStatus('processing', 0);

    let processed = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    // Traitement par batch
    for (let i = 0; i < activitiesToProcess.length; i += batchSize) {
      const batch = activitiesToProcess.slice(i, i + batchSize);
      
      const promises = batch.map(async (activity: StravaActivity): Promise<ImportResult> => {
        try {
          await StravaRedisService.saveActivity(activity);
          return { success: true, id: activity.id };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Error saving activity ${activity.id}:`, error);
          errorDetails.push(`Activity ${activity.id}: ${errorMsg}`);
          return { success: false, id: activity.id, error: errorMsg };
        }
      });

      const results = await Promise.all(promises);
      processed += results.filter(r => r.success).length;
      errors += results.filter(r => !r.success).length;

      // Mise à jour du statut
      const progress = Math.round((processed / activitiesToProcess.length) * 100);
      await StravaRedisService.setImportStatus('processing', progress);
    }

    await StravaRedisService.setImportStatus('completed', 100);
    await StravaRedisService.updateLastSync();

    const response: ImportResponse = {
      message: 'Import completed',
      processed,
      errors,
      total: activitiesToProcess.length,
      truncated: activities.length > maxActivities
    };

    if (errorDetails.length > 0) {
      response.errorDetails = errorDetails.slice(0, 10); // Limiter les détails d'erreur
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('Import error:', error);
    await StravaRedisService.setImportStatus('error', 0);
    
    return res.status(500).json({ 
      error: 'Import failed', 
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Configuration pour Vercel (timeout 30s max)
export const config = {
  maxDuration: 25, // 25 secondes pour laisser de la marge
};
