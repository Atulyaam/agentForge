import { NextResponse } from 'next/server';
import * as fs from 'node:fs';
import { resolveArtifactPath, validateRunId, validateArtifactName } from '@/lib/runs';

export const dynamic = 'force-dynamic';

interface RouteProps {
  params: Promise<{
    runId: string;
    filename: string;
  }>;
}

export async function GET(
  request: Request,
  { params }: RouteProps,
) {
  const { runId, filename } = await params;

  if (!validateRunId(runId)) {
    return NextResponse.json(
      { ok: false, error: 'INPUT_INVALID', message: 'Invalid run ID format' },
      { status: 400 },
    );
  }

  if (!validateArtifactName(filename)) {
    return NextResponse.json(
      { ok: false, error: 'INPUT_INVALID', message: 'Invalid or forbidden artifact name' },
      { status: 400 },
    );
  }

  const resolved = resolveArtifactPath(runId, filename);

  if (!resolved) {
    return NextResponse.json(
      {
        ok: false,
        error: 'ARTIFACT_NOT_FOUND',
        message: `Artifact "${filename}" not found for run "${runId}"`,
      },
      { status: 404 },
    );
  }

  try {
    const fileBuffer = fs.readFileSync(resolved.filePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': resolved.contentType,
        'Content-Length': resolved.sizeBytes.toString(),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, must-revalidate',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Failed to read artifact',
      },
      { status: 500 },
    );
  }
}
