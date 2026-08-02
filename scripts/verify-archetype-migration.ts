#!/usr/bin/env -S npx tsx
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

type DirectCallRow = {
  userId: string;
  adAccountId: number;
};

type ArchetypeColumn = {
  Type: string;
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const unknown = args.filter(arg => arg !== "--json");
  if (unknown.length > 0) {
    process.stderr.write(`Unknown argument: ${unknown[0]}\n`);
    process.exit(2);
  }

  const db = await getDb();
  if (!db) {
    process.stderr.write("DB unavailable — set DATABASE_URL\n");
    process.exit(2);
  }

  const directCallResult = await db.execute(sql`
    SELECT userId, adAccountId
    FROM funnelSettings
    WHERE archetype = 'direct_call'
    ORDER BY userId, adAccountId
  `);
  const columnResult = await db.execute(sql`
    SHOW COLUMNS FROM funnelSettings WHERE Field = 'archetype'
  `);
  const rows = directCallResult[0] as DirectCallRow[];
  const column = (columnResult[0] as ArchetypeColumn[])[0];
  const report = {
    directCallCount: rows.length,
    rows,
    archetypeType: column?.Type ?? null,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`direct_call rows: ${rows.length}\n`);
    for (const row of rows) {
      process.stdout.write(
        `  userId=${row.userId} adAccountId=${row.adAccountId}\n`
      );
    }
    process.stdout.write(`archetype enum: ${report.archetypeType ?? "unknown"}\n`);
  }

  process.exit(rows.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Archetype migration verification failed: ${message}\n`);
  process.exit(2);
});
