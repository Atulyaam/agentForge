import { NextResponse } from 'next/server';
import { getRunEvents, validateRunId } from '@/lib/runs';

export const dynamic = 'force-dynamic';

interface RouteProps {
  params: Promise<{ runId: string }>;
}

export async function GET(
  request: Request,
  { params }: RouteProps,
) {
  const { runId } = await params;

  if (!validateRunId(runId)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'INPUT_INVALID',
        message: 'Invalid run identifier format',
      },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(request.url);
  const afterParam = searchParams.get('after');
  const afterSeq = afterParam !== null ? parseInt(afterParam, 10) : -1;

  try {
    const events = await getRunEvents(runId, isNaN(afterSeq) ? -1 : afterSeq);

    return NextResponse.json({
      ok: true,
      runId,
      events,
      count: events.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Failed to retrieve events',
      },
      { status: 500 },
    );
  }
}
