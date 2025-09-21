// scripts/debug-strava-credentials.ts

import { config } from 'dotenv';

// Charger les variables d'environnement
config();

async function debugStravaCredentials() {
  console.log('🔍 Vérification des credentials Strava...\n');
  
  // Vérifier que les variables sont définies
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  
  console.log('📋 Variables d\'environnement:');
  console.log('Client ID défini:', !!clientId);
  console.log('Client ID valeur:', clientId);
  console.log('Client Secret défini:', !!clientSecret);
  console.log('Client Secret preview:', clientSecret?.substring(0, 8) + '...');
  
  if (!clientId || !clientSecret) {
    console.log('❌ Erreur: Variables manquantes dans .env.local');
    return;
  }
  
  // Test simple : récupérer les infos de l'app
  try {
    console.log('\n🧪 Test de validation des credentials...');
    
    // Test avec l'endpoint de récupération des souscriptions existantes
    const response = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${clientSecret}` // Ce n'est pas correct mais va donner une erreur spécifique
      }
    });
    
    if (response.status === 401) {
      console.log('🔍 Test avec credentials basiques...');
      
      // Test avec les credentials dans une requête POST simple
      const formData = new FormData();
      formData.append('client_id', clientId);
      formData.append('client_secret', clientSecret);
      
      const testResponse = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
        method: 'POST',
        body: formData
      });
      
      const result = await testResponse.text();
      console.log('Status:', testResponse.status);
      console.log('Response:', result);
      
      if (testResponse.status === 400) {
        console.log('✅ Credentials valides (erreur normale car requête incomplète)');
      } else if (testResponse.status === 401) {
        console.log('❌ Credentials invalides');
      }
    }
    
  } catch (error) {
    console.error('❌ Erreur lors du test:', error);
  }
}

debugStravaCredentials();
