// api/test-redis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import redis from '@/lib/redis';

interface TestResponse {
  success: boolean;
  message?: string;
  test_result?: string;
  error?: string;
}

export async function GET(): Promise<NextResponse<TestResponse>> {
  try {
    await redis.set('test', 'Hello from Upstash!');
    const result = await redis.get('test') as string;
    
    return NextResponse.json({ 
      success: true, 
      message: 'Redis connecté avec succès',
      test_result: result 
    });
  } catch (error) {
    console.error('Erreur Redis:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
