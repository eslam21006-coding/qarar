import { getDb } from "./db";
import { users, user as authUser } from "../drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * Get list of all users for admin dashboard.
 */
export async function getAllUsers(): Promise<any[]> {
  try {
    const database = await getDb();
    if (!database) {
      return [];
    }

    // Get users from the users table
    const userList = await database
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
        lastSignedIn: users.lastSignedIn,
      })
      .from(users)
      .limit(1000);

    return userList.map((u: any) => ({
      id: String(u.id),
      name: u.name,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt?.toISOString() || new Date().toISOString(),
      lastSignedIn: u.lastSignedIn?.toISOString() || new Date().toISOString(),
      emailVerified: true, // TODO: Add email verification tracking
    }));
  } catch (err: any) {
    console.error("Error fetching users:", err);
    return [];
  }
}
