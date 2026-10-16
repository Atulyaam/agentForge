import { NextResponse } from 'next/server';
import * as fs from 'node:fs';
import { getRunsDirectory } from '@/lib/runs';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const runsDir = getRunsDirectory();
    const accessible = fs.existsSync(runsDir);

    if (!accessible) {
      // In T1-lite, runsDir can be lazily created or checked
      return NextResponse.json({
        status: 'ready',
        tier: 'T1-lite',
        runsStorage: 'file-based',
        accessible: false,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      status: 'ready',
      tier: 'T1-lite',
      runsStorage: 'file-based',
      accessible: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'degraded',
        message: 'Storage check failed',
      },
      { status: 503 },
    );
  }
}
