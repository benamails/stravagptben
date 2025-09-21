import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === 'true';
  
  try {
    console.log('🔧 Réparation de activities:ids...');
    
    // 1. Vérifier l'état actuel
    const exists = await redis.exists('activities:ids');
    const type = await redis.type('activities:ids');
    
    console.log(`État actuel: exists=${exists}, type=${type}`);
    
    // 2. Supprimer la clé corrompue si elle existe et n'est pas une liste
    if (exists && type !== 'list') {
      if (force) {
        await redis.del('activities:ids');
        console.log('🗑️ Clé corrompue supprimée');
      } else {
        return NextResponse.json({
          success: false,
          message: 'La clé activities:ids existe mais n\'est pas une liste. Utilisez force=true pour la supprimer.',
          current_type: type
        });
      }
    }
    
    // 3. Récupérer toutes les activités valides
    const allKeys = await redis.keys('activity:*');
    const validActivityIds: string[] = [];
    
    for (const key of allKeys) {
      // Filtrer seulement les clés d'activités principales (pas :raw, pas activity_details:)
      const match = key.match(/^activity:(\d+)$/);
      if (match) {
        const activityId = match[1];
        
        // Vérifier que l'activité existe vraiment
        const activityExists = await redis.exists(key);
        if (activityExists) {
          validActivityIds.push(activityId);
        }
      }
    }
    
    // 4. Trier par ID décroissant (plus récent en premier, approximativement)
    validActivityIds.sort((a, b) => parseInt(b) - parseInt(a));
    
    // 5. Créer la nouvelle liste
    if (validActivityIds.length > 0) {
      // S'assurer que la liste est supprimée
      await redis.del('activities:ids');
      
      // Créer la nouvelle liste
      await redis.lpush('activities:ids', ...validActivityIds);
      
      console.log(`📋 Liste activities:ids créée avec ${validActivityIds.length} activités`);
    } else {
      console.log('⚠️ Aucune activité valide trouvée');
    }
    
    // 6. Vérification finale
    const finalType = await redis.type('activities:ids');
    const finalLength = finalType === 'list' ? await redis.llen('activities:ids') : 0;
    
    return NextResponse.json({
      success: true,
      repair_report: {
        activities_found: validActivityIds.length,
        list_created: finalType === 'list',
        final_length: finalLength,
        sample_ids: validActivityIds.slice(0, 5)
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur réparation:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
