// scripts/create-webhook-subscription.ts

import { config } from 'dotenv';
config({ path: '.env.local' });

const createWebhookSubscription = async (): Promise<void> => {
  // ⭐ URL de production
  const PRODUCTION_URL = 'https://stravagptben.vercel.app';
  
  const formData = new FormData();
  formData.append('client_id', process.env.STRAVA_CLIENT_ID!);
  formData.append('client_secret', process.env.STRAVA_CLIENT_SECRET!);
  formData.append('callback_url', `${PRODUCTION_URL}/api/strava-webhook`);
  formData.append('verify_token', process.env.STRAVA_WEBHOOK_VERIFY_TOKEN!);
  
  try {
    console.log('🔄 Création de la souscription webhook de production...');
    console.log('📍 URL callback:', `${PRODUCTION_URL}/api/strava-webhook`);
    
    const response = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
      method: 'POST',
      body: formData
    });
    
    const resultText = await response.text();
    console.log('Status HTTP:', response.status);
    
    if (response.ok) {
      const result = JSON.parse(resultText);
      console.log('✅ Souscription webhook créée avec succès !');
      console.log('📋 Détails:', result);
      console.log(`📝 ID de souscription: ${result.id}`);
      
      // Sauvegarder l'ID
      try {
        const fs = await import('fs');
        fs.writeFileSync('.webhook-subscription-prod-id', result.id.toString());
        console.log('💾 ID sauvegardé dans .webhook-subscription-prod-id');
      } catch (error) {
        console.log('⚠️ Impossible de sauvegarder l\'ID dans un fichier');
      }
    } else {
      console.log('❌ Erreur lors de la création:', resultText);
    }
  } catch (error) {
    console.error('❌ Erreur réseau:', error);
  }
};

createWebhookSubscription();
