import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { username } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
export const auth = betterAuth({
  database: drizzleAdapter(drizzle(new Database(":memory:")), { provider: "sqlite" }),
  secret: "schema-generation-only-not-a-deployment-secret",
  emailAndPassword: { enabled: true },
  plugins: [username({ immutableUsername: true })],
  user: { additionalFields: { isInstanceAdmin: { type: "boolean", defaultValue: false, input: false } } },
});
