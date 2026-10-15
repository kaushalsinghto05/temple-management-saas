import { NextRequest, NextResponse } from 'next/server';
import { seedDemoData } from '@/db/seed';

export async function POST(req: NextRequest) {
  try {
    const result = await seedDemoData();
    return NextResponse.json({
      success: true,
      message: 'Demo data successfully initialized',
      data: result,
    });
  } catch (error: any) {
    console.error('Seed API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to seed data',
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
