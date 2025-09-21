// app/api/user/[userId]/activities/route.ts - push

import { NextRequest, NextResponse } from 'next/server';
import { getUserRawActivities } from '@/lib/activity-processor';
import { getActivityDetails, hasActivityDetails } from '@/lib/redis';

export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const userId = parseInt(params.userId);
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    const includeDetails = searchParams.get('include_details') === 'true';
    const type = searchParams.get('type'); // Filtrer par type d'activité
    
    console.log(`🔍 Activités utilisateur ${userId}: limite=${limit}, détails=${includeDetails}, type=${type}`);
    
    // Récupérer les activités brutes
    let activities = await getUserRawActivities(userId, limit * 2); // Plus pour filtrer
    
    // Filtrer par type si spécifié
    if (type) {
      activities = activities.filter(activity => activity.type === type);
    }
    
    // Limiter au nombre demandé
    activities = activities.slice(0, limit);
    
    // Enrichir avec les détails si demandé
    if (includeDetails) {
      for (const activity of activities) {
        const hasDetails = await hasActivityDetails(activity.id);
        (activity as any).has_details = hasDetails;
        
        if (hasDetails) {
          const details = await getActivityDetails(activity.id);
          if (details) {
            (activity as any).details = details;
          }
        }
      }
    } else {
      // Juste ajouter le flag has_details
      for (const activity of activities) {
        (activity as any).has_details = await hasActivityDetails(activity.id);
      }
    }
    
    // Trier par date (plus récent en premier)
    activities.sort((a, b) => 
      new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
    );
    
    return NextResponse.json({
      success: true,
      count: activities.length,
      filters: {
        userId: userId,
        limit: limit,
        type: type,
        include_details: includeDetails
      },
      activities: activities
    });
  } catch (error) {
    console.error('❌ Erreur récupération activités utilisateur:', error);
    return NextResponse.json(
      { success: false, error: 'Server error' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
