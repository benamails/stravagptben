import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Route générique - peut rediriger vers Strava ou d'autres sources
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'strava';
    
    if (source === 'strava') {
      // Rediriger vers l'API Strava spécifique
      const stravaUrl = new URL('/api/strava/activities', request.url);
      // Copier tous les paramètres
      searchParams.forEach((value, key) => {
        if (key !== 'source') {
          stravaUrl.searchParams.set(key, value);
        }
      });
      
      return Response.redirect(stravaUrl.toString(), 302);
    }
    
    return Response.json({ 
      message: 'Generic activities endpoint',
      availableSources: ['strava'],
      usage: 'Add ?source=strava to your request'
    });
  } catch (error) {
    console.error('API Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
