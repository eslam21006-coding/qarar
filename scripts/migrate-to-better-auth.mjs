import mysql from 'mysql2/promise.js';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function migrate() {
  const conn = await pool.getConnection();
  try {
    console.log('Creating user table...');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS \`user\` (
        \`id\` varchar(36) NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`email\` varchar(255) NOT NULL UNIQUE,
        \`email_verified\` boolean NOT NULL DEFAULT false,
        \`image\` text,
        \`created_at\` timestamp(3) NOT NULL DEFAULT (now()),
        \`updated_at\` timestamp(3) NOT NULL DEFAULT (now()),
        \`subscription_status\` text NOT NULL DEFAULT 'inactive',
        \`ghl_contact_id\` text,
        \`role\` text NOT NULL DEFAULT 'user',
        PRIMARY KEY(\`id\`)
      )
    `);
    console.log('✓ user table created');

    console.log('Creating account table...');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS \`account\` (
        \`id\` varchar(36) NOT NULL,
        \`account_id\` text NOT NULL,
        \`provider_id\` text NOT NULL,
        \`user_id\` varchar(36) NOT NULL,
        \`access_token\` text,
        \`refresh_token\` text,
        \`id_token\` text,
        \`access_token_expires_at\` timestamp(3),
        \`refresh_token_expires_at\` timestamp(3),
        \`scope\` text,
        \`password\` text,
        \`created_at\` timestamp(3) NOT NULL DEFAULT (now()),
        \`updated_at\` timestamp(3) NOT NULL DEFAULT (now()),
        CONSTRAINT \`account_id\` PRIMARY KEY(\`id\`)
      )
    `);
    console.log('✓ account table created');

    console.log('Creating session table...');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS \`session\` (
        \`id\` varchar(36) NOT NULL,
        \`expires_at\` timestamp(3) NOT NULL,
        \`token\` varchar(255) NOT NULL,
        \`created_at\` timestamp(3) NOT NULL DEFAULT (now()),
        \`updated_at\` timestamp(3) NOT NULL DEFAULT (now()),
        \`ip_address\` text,
        \`user_agent\` text,
        \`user_id\` varchar(36) NOT NULL,
        CONSTRAINT \`session_id\` PRIMARY KEY(\`id\`),
        CONSTRAINT \`session_token_unique\` UNIQUE(\`token\`)
      )
    `);
    console.log('✓ session table created');

    console.log('Creating verification table...');
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS \`verification\` (
        \`id\` varchar(36) NOT NULL,
        \`identifier\` text NOT NULL,
        \`value\` text NOT NULL,
        \`expires_at\` timestamp(3) NOT NULL,
        \`created_at\` timestamp(3),
        \`updated_at\` timestamp(3),
        CONSTRAINT \`verification_id\` PRIMARY KEY(\`id\`)
      )
    `);
    console.log('✓ verification table created');

    console.log('Updating userId columns to varchar(36)...');
    const tables = ['actionChecks', 'adAccounts', 'funnelSettings', 'metaConnections', 'snapshots', 'verdictHistory'];
    for (const table of tables) {
      try {
        await conn.execute(`ALTER TABLE \`${table}\` MODIFY COLUMN \`userId\` varchar(36) NOT NULL`);
        console.log(`✓ ${table}.userId updated`);
      } catch (e) {
        if (e.code === 'ER_BAD_FIELD_ERROR') {
          console.log(`⊘ ${table} doesn't have userId column, skipping`);
        } else {
          throw e;
        }
      }
    }

    console.log('\n✓ Migration complete!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await conn.release();
    await pool.end();
  }
}

migrate();
