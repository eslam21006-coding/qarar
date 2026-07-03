import { hashPassword } from "@better-auth/utils/password";
import { drizzle } from "drizzle-orm/mysql2";
import { createConnection } from "mysql2/promise";
import { user, account } from "./drizzle/schema.ts";
import { v4 as uuid } from "uuid";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  try {
    // Parse the connection string
    const url = new URL(dbUrl);
    const connection = await createConnection({
      host: url.hostname,
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1),
      port: url.port ? parseInt(url.port) : 3306,
    });

    const db = drizzle(connection);

    const userId = uuid();
    const password = "MetaReview2026!";
    const hashedPassword = await hashPassword(password);

    console.log("Creating Meta Reviewer account...");
    console.log("User ID:", userId);
    console.log("Email: reviewer@adqarar.com");
    console.log("Name: Meta Reviewer");

    // Delete if exists
    await connection.execute("DELETE FROM account WHERE user_id = ?", [userId]);
    await connection.execute("DELETE FROM user WHERE id = ?", [userId]);

    // Insert user
    await connection.execute(
      `INSERT INTO user (id, name, email, email_verified, subscription_status, role, created_at, updated_at) 
       VALUES (?, ?, ?, 1, 'active', 'user', NOW(3), NOW(3))`,
      [userId, "Meta Reviewer", "reviewer@adqarar.com"]
    );

    // Insert account with hashed password
    await connection.execute(
      `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) 
       VALUES (?, ?, 'credential', ?, ?, NOW(3), NOW(3))`,
      [uuid(), `email-${userId}`, userId, hashedPassword]
    );

    console.log("✓ Account created successfully");
    console.log("✓ Test credentials:");
    console.log("  Email: reviewer@adqarar.com");
    console.log("  Password: MetaReview2026!");

    await connection.end();
    process.exit(0);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
