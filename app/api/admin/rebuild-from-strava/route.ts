import { NextRequest, NextResponse } from 'next/server';
import { getStoredUserToken } from '@/lib/redis';
import { fetchAndProcessActivity } from '@/lib/activity-processor';
import redis from '@/lib/redis';

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = parseInt(searchParams.get('user_id') || '14060676');
  const dryRun = searchParams.get('dry_run') === 'true';
  const maxPages = parseInt(searchParams.get('max_pages') || '20'); // ~1000 activités max
  const flushFirst = searchParams.get('flush') === 'true';
  
  try {
    console.log(`🚀 REBUILD FROM STRAVA ${dryRun ? '(DRY RUN)' : '(RÉEL)'} - User: ${userId}`);
    
    const startTime = Date.now();
    const report = {
      flush_performed: false,
      strava_api_calls: 0,
      activities_found: 0,
      activities_processed: 0,
      activities_with_details: 0,
      errors: [] as string[],
      execution_time_ms: 0,
      rate_limit_remaining: 0
    };
    
    // 1. 🧹 FLUSH de la base si demandé
    if (flushFirst && !dryRun) {
      console.log('🧹 FLUSH de toutes les données...');
      
      // Supprimer toutes les clés liées aux activités
      let cursor = "0";
      const keysToDelete = [];
      
      do {
        const result = await redis.scan(cursor, {
          match: 'activity*',
          count: 100
        });
        cursor = result[0];
        keysToDelete.push(...result[1]);
      } while (cursor !== "0" && keysToDelete.length < 5000);
      
      if (keysToDelete.length > 0) {
        // Supprimer par batch pour éviter les timeouts
        for (let i = 0; i < keysToDelete.length; i += 50) {
          const batch = keysToDelete.slice(i, i + 50);
          await redis.del(...batch);
        }
      }
      
      // Nettoyer les listes spécifiques
      await redis.del('activities:ids', 'activities:last_activity');
      
      report.flush_performed = true;
      console.log(`🗑️ ${keysToDelete.length} clés supprimées`);
    }
    
    // 2. 📡 RÉCUPÉRATION depuis l'API Strava
    const tokenData = await getStoredUserToken(userId);
    if (!tokenData) {
      throw new Error('Token utilisateur introuvable');
    }
    
    const allActivities = [];
