import { NextResponse } from 'next/server';
import { listRuns } from '@/lib/runs';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const runs = await listRuns();
    return NextResponse.json({
      ok: true,
      data: runs,
      count: runs.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list runs',
      },
      { status: 500 },
    );
  }
}
