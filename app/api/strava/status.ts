import type { NextApiRequest, NextApiResponse } from 'next';
import { StravaRedisService } from '../../../lib/strava-redis-vercel';
import type { ImportStatus } from '../../../types/strava';

interface StatusResponse {
  importStatus: ImportStatus;
  lastSync: string | null;
  timestamp: string;
}

interface ErrorResponse {
  error: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<StatusResponse | ErrorResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const importStatus = await StravaRedisService.getImportStatus();
    const lastSync = await StravaRedisService.getLastSync();
    
    const defaultStatus: ImportStatus = {
      status: 'none',
      progress: 0,
      timestamp: new Date().toISOString()
    };

    const response: StatusResponse = {
      importStatus: importStatus || defaultStatus,
      lastSync,
      timestamp: new Date().toISOString()
    };
    
    return res.status(200).json(response);
  } catch (error) {
    console.error('Status check error:', error);
    return res.status(500).json({ error: 'Failed to get status' });
  }
}
