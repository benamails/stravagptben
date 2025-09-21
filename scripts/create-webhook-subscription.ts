import { config } from 'dotenv';

// ⭐ Charger .env.local
config({ path: '.env.local' });

interface WebhookSubscriptionResponse {
  id: number;
  callback_url: string;
  created_at: string;
  updated_at: string;
}

const createWebhookSubscription = async (): Promise<void> => {
  // Debug
  console.log('🔍 Variables chargées:');
  console.log('CLIENT_ID:', process.env.STRAVA_CLIENT_ID ? '✅ Défini' : '❌ Manquant');
  console.log('CLIENT_SECRET:', process.env.STRAVA_CLIENT_SECRET ? '✅ Défini' : '❌ Manquant');
  console.log('VERIFY_TOKEN:', process.env.STRAVA_WEBHOOK_VERIFY_TOKEN ? '✅ Défini' : '❌ Manquant');
  
  // Le reste du code identique...
};

createWebhookSubscription();
