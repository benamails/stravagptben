import { NextRequest, NextResponse } from 'next/server';
import { getUserFormattedActivities } from '@/lib/activity-processor';

export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const userId = parseInt(params.userId);
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    
    const activities = await getUserFormattedActivities(userId, limit);
    
    return NextResponse.json({
      success: true,
      count: activities.length,
      activities
    });
  } catch (error) {
    console.error('Erreur récupération activités:', error);
    return NextResponse.json(
      { success: false, error: 'Erreur serveur' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
