// app/api/auth/strava/callback/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { storeUserToken } from '@/lib/redis';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  
  if (error) {
    console.error('❌ Erreur autorisation Strava:', error);
    return NextResponse.json({ error: 'Authorization denied' }, { status: 400 });
  }
  
  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
  }
  
  try {
    // Échanger le code contre un token
    const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code'
      })
    });
    
    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.status}`);
    }
    
    const tokenData = await tokenResponse.json();
    console.log('✅ Token reçu pour l\'utilisateur:', state);
    
    // Stocker le token dans Redis
    const userId = parseInt(state);
    await storeUserToken(userId, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: tokenData.expires_at,
      token_type: tokenData.token_type
    });
    
    console.log(`💾 Token stocké pour l'utilisateur ${userId}`);
    
    // Rediriger vers une page de succès
    return NextResponse.redirect(new URL('/auth/success', request.url));
    
  } catch (error) {
    console.error('❌ Erreur lors de l\'échange de token:', error);
    return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
