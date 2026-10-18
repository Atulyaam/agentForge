/**
 * Safe test fixture helper ensuring demo runs exist for web viewer tests.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRunsDirectory } from './runs';

export function ensureDemoRunsExist(): void {
  const runsDir = getRunsDirectory();
  if (!fs.existsSync(runsDir)) {
    fs.mkdirSync(runsDir, { recursive: true });
  }

  const demo1 = path.join(runsDir, 'demo-run-001');
  if (!fs.existsSync(demo1)) {
    fs.mkdirSync(demo1, { recursive: true });
    fs.writeFileSync(
      path.join(demo1, 'run.json'),
      JSON.stringify(
        {
          id: 'demo-run-001',
          status: 'succeeded',
          adapterId: 'demo-sentiment',
          inputHash: 'hash-001',
          configSnapshot: { MODEL: 'mock-model' },
          codeVersion: 'test',
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          mode: 'NORMAL',
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(demo1, 'metrics.json'),
      JSON.stringify({ totalRecords: 3, succeededRecords: 3, failedRecords: 0, accuracy: 1.0 }),
    );
    fs.writeFileSync(
      path.join(demo1, 'trace.jsonl'),
      JSON.stringify({
        runId: 'demo-run-001',
        sequence: 0,
        type: 'run_started',
        timestamp: new Date().toISOString(),
        payload: { adapterId: 'demo-sentiment' },
      }) + '\n',
    );
    fs.writeFileSync(
      path.join(demo1, 'output.json'),
      JSON.stringify([{ id: '1', sentiment: 'positive' }]),
    );
  }

  const demo2 = path.join(runsDir, 'demo-run-002');
  if (!fs.existsSync(demo2)) {
    fs.mkdirSync(demo2, { recursive: true });
    fs.writeFileSync(
      path.join(demo2, 'run.json'),
      JSON.stringify(
        {
          id: 'demo-run-002',
          status: 'failed',
          adapterId: 'demo-sentiment',
          inputHash: 'hash-002',
          configSnapshot: {},
          codeVersion: 'test',
          createdAt: new Date().toISOString(),
          mode: 'NORMAL',
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(demo2, 'metrics.json'),
      JSON.stringify({ totalRecords: 2, succeededRecords: 0, failedRecords: 2 }),
    );
    fs.writeFileSync(
      path.join(demo2, 'trace.jsonl'),
      JSON.stringify({
        runId: 'demo-run-002',
        sequence: 0,
        type: 'record_error',
        timestamp: new Date().toISOString(),
        payload: { category: 'SCHEMA_INVALID', message: 'Test schema failure' },
      }) + '\n',
    );
  }
}
