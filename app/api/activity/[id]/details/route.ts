// app/api/activity/[id]/details/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getActivityDetails, hasActivityDetails } from '@/lib/redis';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const activityId = parseInt(params.id);
    
    console.log(`📊 Récupération des détails pour l'activité: ${activityId}`);
    
    const hasDetails = await hasActivityDetails(activityId);
    
    if (!hasDetails) {
      return NextResponse.json(
        { // ⭐ Erreur corrigée : accolade d'objet ouverte
          success: false,
          error: 'Activity details not found',
          activityId,
          message: 'Details are only available for Run activities and may take a few moments to process after activity creation'
        },
        { status: 404 }
      );
    }
    
    const details = await getActivityDetails(activityId);
    
    return NextResponse.json({
      success: true,
      activityId,
      details
    });
  } catch (error) {
    console.error('❌ Erreur récupération détails:', error);
    return NextResponse.json(
      { success: false, error: 'Server error' },
      { status: 500 }
    );
  }
} // ⭐ Erreur corrigée : accolade de fonction fermée

export const dynamic = 'force-dynamic';