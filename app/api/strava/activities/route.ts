import { NextRequest } from 'next/server';
import { StravaRedisService } from '@/lib/strava-redis-vercel';
import type { 
  StravaActivity, 
  StravaActivityDetails, 
  StravaSearchCriteria,
  StravaActivityWithDetails 
} from '@/types/strava';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const sportType = searchParams.get('sportType');
    const limit = searchParams.get('limit');
    const includeDetails = searchParams.get('includeDetails');

    // Récupérer une activité spécifique
    if (id) {
      const activity = await StravaRedisService.getActivity(
        id, 
        includeDetails === 'true'
      );
      
      if (!activity) {
        return Response.json({ error: 'Activity not found' }, { status: 404 });
      }
      
      return Response.json(activity);
    }

    // Rechercher des activités
    const criteria: StravaSearchCriteria = {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      sportType: sportType || undefined,
      limit: limit ? parseInt(limit) : undefined
    };

    const activities = await StravaRedisService.searchActivities(criteria);
    
    return Response.json({
      activities,
      count: activities.length,
      criteria
    });
  } catch (error) {
    console.error('API Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { activity, details }: { 
      activity: StravaActivity; 
      details?: StravaActivityDetails 
    } = await request.json();

    if (!activity || !activity.id) {
      return Response.json({ error: 'Activity data with ID required' }, { status: 400 });
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

    return Response.json({
      activity: savedActivity,
      details: savedDetails,
      message: 'Activity saved successfully'
    }, { status: 201 });
  } catch (error) {
    console.error('API Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
