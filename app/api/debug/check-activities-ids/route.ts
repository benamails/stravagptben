import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';

export async function GET() {
  try {
    // 1. Vérifier l'existence de la clé
    const exists = await redis.exists('activities:ids');
    
    // 2. Vérifier le type de la clé
    const type = await redis.type('activities:ids');
    
    // 3. Essayer de récupérer la valeur selon le type
    let value = null;
    let error = null;
    
    try {
      if (type === 'string') {
        value = await redis.get('activities:ids');
      } else if (type === 'list') {
        value = await redis.lrange('activities:ids', 0, 10);
      } else if (type === 'set') {
        value = await redis.smembers('activities:ids');
      } else {
        value = `Type ${type} not handled`;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    }
    
    // 4. Compter toutes les activités
    const allActivityKeys = await redis.keys('activity:*');
    const validActivityKeys = allActivityKeys.filter(key => 
      /^activity:\d+$/.test(key) && !key.includes(':raw') && !key.includes('activity_details:')
    );
    
    return NextResponse.json({
      activities_ids: {
        exists: exists === 1,
        type: type,
        value: value,
        error: error
      },
      all_activities: {
        total_keys: allActivityKeys.length,
        valid_activity_keys: validActivityKeys.length,
        sample_keys: validActivityKeys.slice(0, 5)
      }
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
