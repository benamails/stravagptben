// app/api/strava-webhook/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { StravaWebhookEvent } from '@/types/strava';

// ⭐ Import nommé avec accolades
import { storeEventInRedis } from '@/lib/redis';
import { fetchAndProcessActivity } from '@/lib/activity-processor';

export async function GET(request: NextRequest) {
  return handleWebhookVerification(request);
}

export async function POST(request: NextRequest) {
  return handleWebhookEvent(request);
}

async function handleWebhookVerification(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const challenge = searchParams.get('hub.challenge');
  const token = searchParams.get('hub.verify_token');
  
  console.log('Webhook verification attempt:', { mode, challenge, token });
  
  if (mode === 'subscribe' && token === process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    console.log('✅ WEBHOOK_VERIFIED');
    return NextResponse.json({ "hub.challenge": challenge });
  } else {
    console.log('❌ Webhook verification failed');
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
}

async function handleWebhookEvent(request: NextRequest) {
  try {
    const eventData: StravaWebhookEvent = await request.json();
    
    console.log('Webhook event received:', eventData);
    
    // Réponse rapide pour Strava (< 2 secondes)
    const response = NextResponse.json({ received: true });
    
    // Traitement asynchrone de l'événement (ne pas attendre)
    processEventAsync(eventData).catch(error => {
      console.error('Erreur dans le traitement asynchrone:', error);
    });
    
    return response;
  } catch (error) {
    console.error('Erreur lors du traitement du webhook:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function processEventAsync(eventData: StravaWebhookEvent): Promise<void> {
  const { object_type, object_id, aspect_type, owner_id, event_time } = eventData;
  
  // Filtrer seulement les nouvelles activités
  if (object_type === 'activity' && aspect_type === 'create') {
    console.log(`Nouvelle activité détectée: ${object_id} par l'athlète ${owner_id}`);
    
    try {
      // ⭐ Utiliser la fonction importée
      await storeEventInRedis(eventData);
      
      // Optionnel : déclencher le traitement immédiat
      await fetchAndProcessActivity(object_id, owner_id);
    } catch (error) {
      console.error('Erreur lors du traitement de l\'événement:', error);
    }
  }
}

// Configuration App Router
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
