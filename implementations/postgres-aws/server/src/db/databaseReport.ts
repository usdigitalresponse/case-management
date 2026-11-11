// What a deployment's own database shows about query performance, as text
// safe to share: query shapes and table statistics, never stored values.
// Read-only; see ../../../README.md "Checking performance on your own data".
import type { Pool, PoolClient } from 'pg';

const SLOWEST_SHOWN = 15;
// Full scans of smaller tables are cheap and normal.
const SCANNED_TABLE_MIN_ROWS = 10_000;

const table = (headers: string[], rows: Array<Array<string | number>>) =>
  [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');

const oneLine = (sql: string) => sql.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 300);
const ms = (value: number) => Math.round(value * 10) / 10;

async function slowestQueries(client: PoolClient): Promise<string> {
  const { rows: installed } = await client.query(`select 1 from pg_extension where extname = 'pg_stat_statements'`);
  if (installed.length === 0) {
    return 'pg_stat_statements is not enabled, so the slowest queries are unknown. See the README to turn it on.';
  }
  await client.query('savepoint statements');
  try {
    const { rows } = await client.query<{ total: number; calls: string; mean: number; rows: string; query: string }>(
      `select total_exec_time as total, calls, mean_exec_time as mean, rows, query
       from pg_stat_statements where dbid = (select oid from pg_database where datname = current_database())
         -- Only these have their values replaced; other commands keep theirs as written.
         and query ~* '^\\s*(select|insert|update|delete|with)\\M'
       order by total_exec_time desc limit $1`,
      [SLOWEST_SHOWN],
    );
    return rows.length === 0
      ? 'No queries recorded yet.'
      : table(['total ms', 'calls', 'mean ms', 'rows', 'query'], rows.map((row) => [ms(row.total), row.calls, ms(row.mean), row.rows, oneLine(row.query)]));
  } catch (error) {
    // Installed but not loaded at startup (shared_preload_libraries).
    await client.query('rollback to savepoint statements');
    return `pg_stat_statements is installed but can't be read: ${(error as Error).message}`;
  }
}

async function scannedTables(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ name: string; live: string; seq_scan: string; seq_read: string; idx_scan: string | null }>(
    `select relname as name, n_live_tup as live, seq_scan, seq_tup_read as seq_read, idx_scan
     from pg_stat_user_tables
     where n_live_tup >= $1 and seq_scan > coalesce(idx_scan, 0)
     order by seq_tup_read desc`,
    [SCANNED_TABLE_MIN_ROWS],
  );
  return rows.length === 0
    ? `None: every table of ${SCANNED_TABLE_MIN_ROWS.toLocaleString('en-US')} rows or more is read mostly through indexes.`
    : table(['table', 'rows', 'full scans', 'rows read by them', 'index scans'], rows.map((row) => [row.name, row.live, row.seq_scan, row.seq_read, row.idx_scan ?? 0]));
}

async function unindexedForeignKeys(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ name: string; column_name: string; live: string }>(
    `select c.conrelid::regclass::text as name, a.attname as column_name, coalesce(s.n_live_tup, 0) as live
     from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     left join pg_stat_user_tables s on s.relid = c.conrelid
     where c.contype = 'f' and cardinality(c.conkey) = 1 and c.connamespace = 'public'::regnamespace
       and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
       and coalesce(s.n_live_tup, 0) >= $1
     order by live desc, name, column_name`,
    [SCANNED_TABLE_MIN_ROWS],
  );
  return rows.length === 0
    ? 'None on tables this large.'
    : table(['table', 'column', 'rows'], rows.map((row) => [row.name, row.column_name, row.live]));
}

async function unusedIndexes(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ name: string; index: string; size: string }>(
    `select s.relname as name, s.indexrelname as index, pg_size_pretty(pg_relation_size(s.indexrelid)) as size
     from pg_stat_user_indexes s join pg_index i on i.indexrelid = s.indexrelid
     where s.idx_scan = 0 and not i.indisunique
     order by pg_relation_size(s.indexrelid) desc`,
  );
  return rows.length === 0 ? 'None.' : table(['table', 'index', 'size'], rows.map((row) => [row.name, row.index, row.size]));
}

export async function buildDatabaseReport(pool: Pool): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('begin transaction read only');
    const { rows: [about] } = await client.query<{ version: string; since: Date | null }>(
      `select current_setting('server_version') as version, stats_reset as since from pg_stat_database where datname = current_database()`,
    );
    const sections = [
      ['Slowest queries, by total time', await slowestQueries(client)],
      [`Tables of ${SCANNED_TABLE_MIN_ROWS.toLocaleString('en-US')}+ rows read mostly by full scans`, await scannedTables(client)],
      // Not every one needs an index: it helps when lookups go by that column.
      ['Foreign keys with no index starting with them, on those tables', await unindexedForeignKeys(client)],
      ['Indexes never used (other than unique ones)', await unusedIndexes(client)],
    ];
    return [
      '# Database report',
      `PostgreSQL ${about?.version}; statistics since ${about?.since ? about.since.toISOString() : 'they were last reset or the server started'}.`,
      ...sections.map(([heading, body]) => `## ${heading}\n\n${body}`),
    ].join('\n\n');
  } finally {
    await client.query('rollback');
    client.release();
  }
}
