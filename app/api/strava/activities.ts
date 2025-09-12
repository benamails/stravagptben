import type { NextApiRequest, NextApiResponse } from 'next';
import { StravaRedisService } from '../../../lib/strava-redis-vercel';
import type { 
  StravaActivity, 
  StravaActivityDetails, 
  StravaSearchCriteria,
  StravaActivityWithDetails 
} from '../../../types/strava';

interface GetActivitiesResponse {
  activities: StravaActivity[];
  count: number;
  criteria: StravaSearchCriteria;
}

interface PostActivityResponse {
  activity: StravaActivity;
  details?: StravaActivityDetails;
  message: string;
}

interface ErrorResponse {
  error: string;
  message?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    StravaActivityWithDetails | GetActivitiesResponse | PostActivityResponse | ErrorResponse
  >
) {
  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res);
      case 'POST':
        return await handlePost(req, res);
      default:
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse<StravaActivityWithDetails | GetActivitiesResponse | ErrorResponse>
) {
  const { 
    id, 
    startDate, 
    endDate, 
    sportType, 
    limit, 
    includeDetails 
  } = req.query;

  // Récupérer une activité spécifique
  if (id && typeof id === 'string') {
    const activity = await StravaRedisService.getActivity(
      id, 
      includeDetails === 'true'
    );
    
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    
    return res.status(200).json(activity);
  }

  // Rechercher des activités
  const criteria: StravaSearchCriteria = {
    startDate: typeof startDate === 'string' ? startDate : undefined,
    endDate: typeof endDate === 'string' ? endDate : undefined,
    sportType: typeof sportType === 'string' ? sportType : undefined,
    limit: limit ? parseInt(limit as string) : undefined
  };

  const activities = await StravaRedisService.searchActivities(criteria);
  
  const response: GetActivitiesResponse = {
    activities,
    count: activities.length,
    criteria
  };
  
  return res.status(200).json(response);
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse<PostActivityResponse | ErrorResponse>
) {
  const { activity, details }: { activity: StravaActivity; details?: StravaActivityDetails } = req.body;

  if (!activity || !activity.id) {
    return res.status(400).json({ error: 'Activity data with ID required' });
  }

  // Sauvegarder l'activité de base
  const savedActivity = await StravaRedisService.saveActivity(activity);

  // Sauvegarder les détails si fournis
  let savedDetails: StravaActivityDetails | undefined;
  if (details) {
    savedDetails = await StravaRedisService.saveActivityDetails(
      activity.id, 
      details
    );
  }

  const response: PostActivityResponse = {
    activity: savedActivity,
    message: 'Activity saved successfully'
  };

  if (savedDetails) {
    response.details = savedDetails;
  }

  return res.status(201).json(response);
}
