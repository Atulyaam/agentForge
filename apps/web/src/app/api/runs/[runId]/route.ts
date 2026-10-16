import { NextResponse } from 'next/server';
import { getRunDetails, validateRunId } from '@/lib/runs';

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

  const run = await getRunDetails(runId);

  if (!run) {
    return NextResponse.json(
      {
        ok: false,
        error: 'RUN_NOT_FOUND',
        message: `Run "${runId}" was not found`,
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: run,
  });
}
