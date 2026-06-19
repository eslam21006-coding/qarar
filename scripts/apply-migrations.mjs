import { readFileSync } from 'fs';
import { createConnection } from 'mysql2/promise';
import { URL } from 'url';

async function runMigrations() {
  const dbUrl = new URL(process.env.DATABASE_URL);
  
  const connection = await createConnection({
    host: dbUrl.hostname,
    user: dbUrl.username,
    password: dbUrl.password,
    database: dbUrl.pathname.slice(1),
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Reading migration files...');
    const migration0005 = readFileSync('./drizzle/0005_add_better_auth_tables.sql', 'utf-8');
    const migration0006 = readFileSync('./drizzle/0006_calm_dagger.sql', 'utf-8');

    // Split by statement separator and filter empty statements
    let statements0005 = migration0005
      .split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));

    // Fix TiDB compatibility
    statements0005 = statements0005.map(stmt => {
      // Replace DEFAULT (now()) with DEFAULT CURRENT_TIMESTAMP(3) for timestamp(3) columns
      stmt = stmt.replace(/DEFAULT \(now\(\)\)/g, 'DEFAULT CURRENT_TIMESTAMP(3)');
      // Remove DEFAULT from text columns (TiDB doesn't support defaults on TEXT/BLOB columns)
      // Match: DEFAULT ('value') or DEFAULT 'value'
      stmt = stmt.replace(/`(subscription_status|ghl_contact_id|role)` text NOT NULL DEFAULT \('[^']*'\)/g, '`$1` text NOT NULL');
      stmt = stmt.replace(/`(subscription_status|ghl_contact_id|role)` text NOT NULL DEFAULT '[^']*'/g, '`$1` text NOT NULL');
      stmt = stmt.replace(/`(subscription_status|ghl_contact_id|role)` text DEFAULT \('[^']*'\)/g, '`$1` text');
      stmt = stmt.replace(/`(subscription_status|ghl_contact_id|role)` text DEFAULT '[^']*'/g, '`$1` text');
      return stmt;
    });

    let statements0006 = migration0006
      .split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));

    statements0006 = statements0006.map(stmt => {
      // Remove DEFAULT from text columns
      stmt = stmt.replace(/`(subscription_status|ghl_contact_id|role)` text NOT NULL DEFAULT \('[^']*'\)/g, '`$1` text NOT NULL');
      stmt = stmt.replace(/`(subscription_status|ghl_contact_id|role)` text NOT NULL DEFAULT '[^']*'/g, '`$1` text NOT NULL');
      stmt = stmt.replace(/`(subscription_status|ghl_contact_id|role)` text DEFAULT \('[^']*'\)/g, '`$1` text');
      stmt = stmt.replace(/`(subscription_status|ghl_contact_id|role)` text DEFAULT '[^']*'/g, '`$1` text');
      return stmt;
    });

    console.log(`\nApplying migration 0005 (${statements0005.length} statements)...`);
    for (const stmt of statements0005) {
      if (stmt) {
        try {
          await connection.execute(stmt);
          console.log('✓', stmt.substring(0, 60) + (stmt.length > 60 ? '...' : ''));
        } catch (e) {
          if (e.code === 'ER_TABLE_EXISTS_ERROR') {
            console.log('⊘ Table already exists, skipping');
          } else {
            console.error('Error:', e.message);
            console.error('Statement:', stmt.substring(0, 200));
            throw e;
          }
        }
      }
    }

    console.log(`\nApplying migration 0006 (${statements0006.length} statements)...`);
    for (const stmt of statements0006) {
      if (stmt) {
        try {
          await connection.execute(stmt);
          console.log('✓', stmt.substring(0, 60) + (stmt.length > 60 ? '...' : ''));
        } catch (e) {
          if (e.code === 'ER_BAD_FIELD_ERROR') {
            console.log('⊘ Column already modified or doesn\'t exist, skipping');
          } else if (e.code === 'ER_DUP_FIELDNAME') {
            console.log('⊘ Column already exists, skipping');
          } else {
            console.error('Error:', e.message);
            throw e;
          }
        }
      }
    }

    console.log('\n✓ All migrations applied successfully!');
  } catch (error) {
    console.error('\n✗ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

runMigrations();
