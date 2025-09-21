// app/api/admin/strava-import-robust/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Redis from 'ioredis';

// Initialize Redis client (adapt to your config)
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

interface RateLimitInfo {
  shortTerm: { limit: number; usage: number };
  daily: { limit: number; usage: number };
}

interface StravaActivity {
  id: number;
  name: string;
  start_date: string;
  type: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  average_watts?: number;
  // Add other fields as needed
}

function parseRateLimit(headers: Headers): RateLimitInfo {
  const limitHeader = headers.get('X-RateLimit-Limit') || '100,1000';
  const usageHeader = headers.get('X-RateLimit-Usage') || '0,0';
  
  const [shortLimit, dailyLimit] = limitHeader.split(',').map(n => parseInt(n));
  const [shortUsage, dailyUsage] = usageHeader.split(',').map(n => parseInt(n));
  
  return {
    shortTerm: { limit: shortLimit, usage: shortUsage },
    daily: { limit: dailyLimit, usage: dailyUsage }
  };
}

function waitForRateLimitReset(): Promise<void> {
  return new Promise((resolve) => {
    const now = new Date();
    const minutes = now.getMinutes();
    const nextReset = new Date();
    
    // Prochain interval de 15 minutes (0, 15, 30, 45)
    const nextInterval = Math.ceil((minutes + 1) / 15) * 15;
    nextReset.setMinutes(nextInterval, 0, 0);
    
    if (nextInterval >= 60) {
      nextReset.setHours(nextReset.getHours() + 1);
      nextReset.setMinutes(0, 0, 0);
    }
    
    const waitTime = nextReset.getTime() - now.getTime() + 1000; // +1s sécurité
    console.log(`Waiting ${Math.round(waitTime/1000)}s until rate limit resets...`);
    
    setTimeout(resolve, waitTime);
  });
}

async function fetchStravaActivitiesWithRetry(
  accessToken: string,
  page: number, 
  maxRetries = 3
): Promise<{ activities: StravaActivity[]; headers: Headers }> {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      const response = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=100`,
        {
          headers: { 
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
          }
        }
      );
      
      if (response.status === 429) {
        throw { status: 429, message: 'Rate limited' };
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const activities = await response.json();
      return { activities, headers: response.headers };
      
    } catch (error: any) {
      attempt++;
      if (attempt >= maxRetries) throw error;
      
      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`Retry ${attempt}/${maxRetries} in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error('Max retries exceeded');
}

async function storeActivitiesInRedis(userId: string, activities: StravaActivity[]): Promise<void> {
  if (activities.length === 0) return;
  
  const pipeline = redis.pipeline();
  
  activities.forEach(activity => {
    const key = `activities:${userId}:${activity.id}`;
    pipeline.set(key, JSON.stringify(activity));
    
    // Index par date (année-mois)
    const dateIndex = activity.start_date.substring(0, 7); // "2025-09"
    pipeline.sadd(`activities:${userId}:index:${dateIndex}`, activity.id);
    
    // Index global
    pipeline.sadd(`activities:${userId}:all`, activity.id);
  });
  
  await pipeline.exec();
  console.log(`Stored ${activities.length} activities in Redis`);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');
  const startPage = parseInt(searchParams.get('start_page') || '1');
  const maxPages = parseInt(searchParams.get('max_pages') || '1000');
  const accessToken = searchParams.get('access_token') || process.env.STRAVA_ACCESS_TOKEN;
  
  if (!userId) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  }
  
  if (!accessToken) {
    return NextResponse.json({ error: 'access_token is required' }, { status: 400 });
  }
  
  let currentPage = startPage;
  let totalImported = 0;
  let shouldContinue = true;
  
  try {
    while (shouldContinue && currentPage <= maxPages) {
      try {
        console.log(`Fetching page ${currentPage}...`);
        const response = await fetchStravaActivitiesWithRetry(accessToken, currentPage);
        const rateLimit = parseRateLimit(response.headers);
        
        console.log(`Page ${currentPage}: ${response.activities.length} activities, Rate: ${rateLimit.shortTerm.usage}/${rateLimit.shortTerm.limit}`);
        
        // Store in Redis
        await storeActivitiesInRedis(userId, response.activities);
        totalImported += response.activities.length;
        
        // Save progress
        await redis.set(`import:${userId}:last_page`, currentPage);
        await redis.set(`import:${userId}:total_imported`, totalImported);
        
        // Check if we need to pause
        if (rateLimit.shortTerm.usage >= rateLimit.shortTerm.limit - 5) {
          console.log('Rate limit approaching, waiting for reset...');
          await waitForRateLimitReset();
        }
        
        // Stop if no more activities
        if (response.activities.length === 0) {
          shouldContinue = false;
          console.log('No more activities to fetch');
        }
        
        currentPage++;
        
      } catch (error: any) {
        if (error.status === 429) {
          console.log('Rate limited, waiting for reset...');
          await waitForRateLimitReset();
          continue; // Retry same page
        }
        throw error;
      }
    }
    
    return NextResponse.json({
      success: true,
      imported: totalImported,
      lastPage: currentPage - 1,
      message: `Successfully imported ${totalImported} activities`
    });
    
  } catch (error: any) {
    console.error('Import failed:', error);
    return NextResponse.json({
      error: error.message || 'Import failed',
      imported: totalImported,
      lastPage: currentPage - 1
    }, { status: 500 });
  }
}
