/**
 * DemoAdapter — Working reference implementation of ChallengeAdapter (FR-028).
 *
 * Demonstrates the full pipeline with a simple "classify sentiment" task.
 * Uses a mock LLM for testing; real LLM when running live.
 *
 * Input: JSON array of { id, text }
 * Output: JSON array of { id, text, sentiment, confidence }
 */

import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChallengeAdapter, AdapterDeps, ParseResult, ValidationResult } from '@agentforge/adapter-kit';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const DemoInputSchema = z.object({
  id: z.string(),
  text: z.string(),
});

type DemoInput = z.infer<typeof DemoInputSchema>;

const DemoDecisionSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

type DemoDecision = z.infer<typeof DemoDecisionSchema>;

interface DemoOutput {
  id: string;
  text: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const DemoAdapter: ChallengeAdapter<DemoInput, string, DemoDecision, DemoOutput> = {
  id: 'demo-sentiment',
  version: '1.0.0',

  parseInput(raw: string | Buffer): ParseResult<DemoInput> {
    const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
    const batchErrors: string[] = [];
    const recordErrors: Array<{ id?: string; row?: number; message: string }> = [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { records: [], batchErrors: ['Invalid JSON input'], recordErrors: [] };
    }

    if (!Array.isArray(parsed)) {
      return { records: [], batchErrors: ['Input must be a JSON array'], recordErrors: [] };
    }

    const records: DemoInput[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const result = DemoInputSchema.safeParse(parsed[i]);
      if (result.success) {
        records.push(result.data);
      } else {
        recordErrors.push({
          row: i + 1,
          id: (parsed[i] as Record<string, unknown>)?.id as string | undefined,
          message: result.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`).join('; '),
        });
      }
    }

    return { records, batchErrors, recordErrors };
  },

  recordId(rec: DemoInput): string {
    return rec.id;
  },

  normalize(rec: DemoInput): DemoInput {
    return {
      id: rec.id.trim(),
      text: rec.text.trim(),
    };
  },

  async buildContext(rec: DemoInput, _deps: AdapterDeps): Promise<string> {
    // Simple demo: context is just the text itself
    return rec.text;
  },

  async decide(rec: DemoInput, ctx: string, deps: AdapterDeps): Promise<DemoDecision> {
    const { data } = await deps.llm.callStructured({
      schema: DemoDecisionSchema,
      schemaName: 'DemoDecision',
      promptVersion: 'demo-v1',
      systemPrompt: [
        'You are a sentiment classifier.',
        'Analyze the given text and return a JSON object with:',
        '- sentiment: "positive", "negative", or "neutral"',
        '- confidence: a number between 0 and 1',
        '- reasoning: a brief explanation',
        'Return ONLY valid JSON, no additional text.',
      ].join('\n'),
      userPrompt: `Classify the sentiment of this text:\n\n"${ctx}"`,
      temperature: 0.1,
    });

    deps.log('decision_made', {
      recordId: rec.id,
      sentiment: data.sentiment,
      confidence: data.confidence,
    });

    return data;
  },

  toOutput(rec: DemoInput, decision: DemoDecision): DemoOutput {
    return {
      id: rec.id,
      text: rec.text,
      sentiment: decision.sentiment,
      confidence: decision.confidence,
    };
  },

  validateOutput(outputs: DemoOutput[], inputs: DemoInput[]): ValidationResult {
    const problems: string[] = [];

    if (outputs.length !== inputs.length) {
      problems.push(`Output count ${outputs.length} ≠ input count ${inputs.length}`);
    }

    const outputIds = new Set(outputs.map((o) => o.id));
    const inputIds = new Set(inputs.map((i) => i.id));

    for (const id of inputIds) {
      if (!outputIds.has(id)) {
        problems.push(`Missing output for input ID: ${id}`);
      }
    }

    // Check for duplicates
    if (outputIds.size !== outputs.length) {
      problems.push('Duplicate output IDs detected');
    }

    // Validate each output
    for (const o of outputs) {
      if (!['positive', 'negative', 'neutral'].includes(o.sentiment)) {
        problems.push(`Invalid sentiment for ${o.id}: ${o.sentiment}`);
      }
      if (o.confidence < 0 || o.confidence > 1) {
        problems.push(`Invalid confidence for ${o.id}: ${o.confidence}`);
      }
    }

    return { ok: problems.length === 0, problems };
  },

  async writeOutput(outputs: DemoOutput[], outputPath: string): Promise<void> {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify(outputs, null, 2));
  },

  async evaluate(outputs: DemoOutput[], expected: unknown): Promise<Record<string, number | 'unavailable'>> {
    if (!Array.isArray(expected)) {
      return { accuracy: 'unavailable', coverage: outputs.length > 0 ? 1 : 0 };
    }

    const expectedMap = new Map<string, string>();
    for (const e of expected as Array<{ id: string; sentiment: string }>) {
      expectedMap.set(e.id, e.sentiment);
    }

    let correct = 0;
    let total = 0;
    for (const o of outputs) {
      const exp = expectedMap.get(o.id);
      if (exp !== undefined) {
        total++;
        if (o.sentiment === exp) correct++;
      }
    }

    return {
      accuracy: total > 0 ? correct / total : 'unavailable',
      coverage: outputs.length / Math.max(expectedMap.size, 1),
      totalEvaluated: total,
      correctCount: correct,
    };
  },
};
