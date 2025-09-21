// app/api/activity/[ID]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import redis, { getActivityDetails, hasActivityDetails } from '@/lib/redis';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const activityId = parseInt(params.id);
    const { searchParams } = new URL(request.url);
    const includeDetails = searchParams.get('include_details') === 'true';
    
    console.log(`🔍 Recherche de l'activité: ${activityId} (détails: ${includeDetails})`);
    
    // Récupérer l'activité de base
    const activityData = await redis.get(`activity:${activityId}`);
    
    if (!activityData) {
      return NextResponse.json(
        { success: false, error: 'Activity not found', activityId },
        { status: 404 }
      );
    }
    
    const parsedActivity = typeof activityData === 'string'
      ? JSON.parse(activityData)
      : activityData;
    
    // ⭐ Vérifier si des détails sont disponibles
    const hasDetails = await hasActivityDetails(activityId);
    
    let response: any = {
      success: true,
      activity: {
        ...parsedActivity,
        has_details: hasDetails
      }
    }; // ⭐ Erreur corrigée : accolade manquante fermée
    
    // ⭐ Inclure les détails si demandés et disponibles
    if (includeDetails && hasDetails) {
      const details = await getActivityDetails(activityId);
      if (details) {
        response.activity.details = details;
        console.log(`📊 Détails inclus pour l'activité ${activityId}`);
      }
    }
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('❌ Erreur récupération activité:', error);
    return NextResponse.json(
      { success: false, error: 'Server error' },
      { status: 500 }
    );
  }
} // ⭐ Erreur corrigée : accolade de fonction fermée

export const dynamic = 'force-dynamic';
