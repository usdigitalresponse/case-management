// Times each check and counts its queries; see ../../README.md "Performance tests".
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import type { Volume } from './volume';

export interface Measurement {
  name: string;
  group: string;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  // The most any timed run made.
  queries: number;
  // With PERF_SLOW_QUERIES=1: its slowest statements, for EXPLAIN.
  slowQueries?: SlowQuery[];
}

export interface SlowQuery {
  ms: number;
  sql: string;
  values: unknown[];
}

interface SavedRun {
  volume: { scale: number };
  measurements: Measurement[];
}

interface QueryCounts {
  scale: number;
  counts: Record<string, number>;
}

// Query counts are saved and checked only at this scale.
export const QUERY_COUNT_SCALE = 0.1;

const RESULTS_DIR = join(__dirname, 'results');
const BASELINE = join(RESULTS_DIR, 'baseline.json');
const QUERY_COUNTS = join(__dirname, 'queryCounts.json');
export const ITERATIONS = Math.max(1, Number(process.env.PERF_ITERATIONS ?? 7));
export const SAVING_BASELINE = process.env.PERF_SAVE_BASELINE === '1';
export const SAVING_QUERY_COUNTS = process.env.PERF_SAVE_QUERY_COUNTS === '1';
const RECORDING_SLOW_QUERIES = process.env.PERF_SLOW_QUERIES === '1';
const SLOW_QUERIES_SHOWN = 3;
// A check this much slower than its baseline fails, with slack for noise.
const REGRESSION_FACTOR = 1.5;
const REGRESSION_SLACK_MS = 20;

const keyOf = (row: Pick<Measurement, 'group' | 'name'>) => `${row.group} / ${row.name}`;
const readJson = <T>(path: string): T | undefined => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined);
const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

let queries = 0;
let timed: SlowQuery[] | null = null;

function record(args: unknown[], start: number) {
  const [first, second] = args as [string | { text: string; values?: unknown[] }, unknown];
  const sql = typeof first === 'string' ? first : first.text;
  const values = typeof first === 'string' ? (Array.isArray(second) ? second : []) : (first.values ?? []);
  timed?.push({ ms: round(performance.now() - start), sql, values });
}

// Every query goes through a pooled client, including pool.query and transactions.
export function countQueries(pool: Pool): void {
  pool.on('connect', (client) => {
    const query = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
      queries += 1;
      if (!timed) return query(...args);
      const start = performance.now();
      // pool.query passes a callback; drizzle awaits the promise.
      const callback = args.at(-1);
      if (typeof callback === 'function') {
        return query(...args.slice(0, -1), (...results: unknown[]) => {
          record(args, start);
          (callback as (...results: unknown[]) => void)(...results);
        });
      }
      const pending = query(...args) as Promise<unknown>;
      return pending.finally(() => record(args, start));
    };
  });
}

const results: Measurement[] = [];

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

const round = (ms: number) => Math.round(ms * 10) / 10;

// Run 0 is an untimed warm-up; returns the last run's result.
export async function measure<T>(group: string, name: string, run: (runNumber: number) => Promise<T>): Promise<{ result: T; measurement: Measurement }> {
  let result = await run(0);
  const times: number[] = [];
  let most = 0;
  if (RECORDING_SLOW_QUERIES) timed = [];
  for (let i = 1; i <= ITERATIONS; i += 1) {
    const before = queries;
    const start = performance.now();
    result = await run(i);
    times.push(performance.now() - start);
    most = Math.max(most, queries - before);
  }
  times.sort((a, b) => a - b);
  const slowest = new Map<string, SlowQuery>();
  for (const query of timed ?? []) {
    if ((slowest.get(query.sql)?.ms ?? -1) < query.ms) slowest.set(query.sql, query);
  }
  timed = null;
  const measurement: Measurement = {
    name,
    group,
    medianMs: round(percentile(times, 50)),
    p95Ms: round(percentile(times, 95)),
    minMs: round(times[0]!),
    queries: most,
    ...(RECORDING_SLOW_QUERIES ? { slowQueries: [...slowest.values()].sort((a, b) => b.ms - a.ms).slice(0, SLOW_QUERIES_SHOWN) } : {}),
  };
  results.push(measurement);
  return { result, measurement };
}

// Only against a baseline saved at the same scale.
export function regressions(scale: number): { failures: string[]; notes: string[] } {
  const saved = readJson<SavedRun>(BASELINE);
  if (!saved || SAVING_BASELINE) return { failures: [], notes: [] };
  if (saved.volume.scale !== scale) {
    return { failures: [], notes: [`perf/results/baseline.json was saved at PERF_SCALE=${saved.volume.scale}, so this run at ${scale} isn't compared with it.`] };
  }
  const baseline = new Map(saved.measurements.map((row) => [keyOf(row), row]));
  const failures = results.flatMap((row) => {
    const before = baseline.get(keyOf(row));
    if (!before) return [];
    const slower = row.medianMs > before.medianMs * REGRESSION_FACTOR + REGRESSION_SLACK_MS;
    return slower || row.queries > before.queries
      ? [`${keyOf(row)}: ${before.medianMs} ms, ${before.queries} queries → ${row.medianMs} ms, ${row.queries} queries`]
      : [];
  });
  return { failures, notes: [] };
}

// A counts file saved at another scale fails.
export function queryCountChanges(scale: number): { failures: string[]; notes: string[] } {
  if (SAVING_QUERY_COUNTS || scale !== QUERY_COUNT_SCALE) return { failures: [], notes: [] };
  const saved = readJson<QueryCounts>(QUERY_COUNTS);
  if (!saved) return { failures: ['perf/queryCounts.json is missing.'], notes: [] };
  if (saved.scale !== QUERY_COUNT_SCALE) {
    return { failures: [`perf/queryCounts.json was saved at PERF_SCALE=${saved.scale}; save it with npm run test:perf:queries.`], notes: [] };
  }
  const failures: string[] = [];
  const notes: string[] = [];
  const measured = new Set(results.map(keyOf));
  for (const row of results) {
    const before = saved.counts[keyOf(row)];
    if (before === undefined) failures.push(`${keyOf(row)}: not in perf/queryCounts.json`);
    else if (row.queries > before) failures.push(`${keyOf(row)}: ${before} → ${row.queries} queries`);
    else if (row.queries < before) notes.push(`${keyOf(row)}: ${before} → ${row.queries} queries`);
  }
  for (const key of Object.keys(saved.counts)) {
    if (!measured.has(key)) failures.push(`${key}: in perf/queryCounts.json but not measured`);
  }
  return { failures, notes };
}

// Refuses to save from an incomplete run, or query counts at another scale.
export function writeReport(volume: Volume & { scale: number; invoices: number; lines: number }, everyCheckPassed: boolean): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const report = { recordedAt: new Date().toISOString(), iterations: ITERATIONS, volume, measurements: results };
  writeJson(join(RESULTS_DIR, 'latest.json'), report);
  const refused: string[] = [];
  if (SAVING_BASELINE || SAVING_QUERY_COUNTS) {
    if (!everyCheckPassed) refused.push('Nothing saved: not every check ran and passed.');
    else if (SAVING_QUERY_COUNTS && volume.scale !== QUERY_COUNT_SCALE) refused.push('Query counts not saved: save them with npm run test:perf:queries.');
  }
  if (refused.length === 0 && SAVING_BASELINE) writeJson(BASELINE, report);
  if (refused.length === 0 && SAVING_QUERY_COUNTS) {
    writeJson(QUERY_COUNTS, { scale: volume.scale, counts: Object.fromEntries(results.map((row) => [keyOf(row), row.queries])) });
  }
  const saved = readJson<SavedRun>(BASELINE);
  const baseline = new Map(saved?.volume.scale === volume.scale ? saved.measurements.map((row) => [keyOf(row), row]) : []);
  const width = Math.max(0, ...results.map((row) => keyOf(row).length));
  const lines = results
    .slice()
    .sort((a, b) => b.medianMs - a.medianMs)
    .map((row) => {
      const before = baseline.get(keyOf(row));
      const change = before && !SAVING_BASELINE ? `  (baseline ${before.medianMs} ms, ${before.queries} q)` : '';
      const line = `${keyOf(row).padEnd(width)}  ${String(row.medianMs).padStart(8)} ms  p95 ${String(row.p95Ms).padStart(8)} ms  ${String(row.queries).padStart(5)} q${change}`;
      const slow = (row.slowQueries ?? []).map((query) => `    ${String(query.ms).padStart(8)} ms  ${query.sql.replace(/\s+/g, ' ').slice(0, 300)}`);
      return [line, ...slow].join('\n');
    });
  const text = [
    `Volume: ${volume.professionals} professionals, ${volume.cases} cases, ${volume.invoices} invoices, ${volume.lines} lines; ${ITERATIONS} runs each`,
    ...lines,
  ].join('\n');
  if (refused.length > 0) throw new Error(`${text}\n\n${refused.join('\n')}`);
  return text;
}
