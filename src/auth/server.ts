import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { username } from "better-auth/plugins";

import { getDatabase, openDatabase } from "../db/client";
import * as schema from "../db/schema";
import { readAuthConfig, type AuthConfig } from "./config";
import { identitySchema } from "./identity";

export function isInitialized(connection = getDatabase()) {
  return Boolean(connection.db.select().from(schema.instanceSetup).get());
}

export function createAuth(connection: ReturnType<typeof openDatabase>, config: AuthConfig) {
  return betterAuth({
    appName: "Homebooks",
    baseURL: config.origin,
    secret: config.secret,
    trustedOrigins: [config.origin],
    database: drizzleAdapter(connection.db, { provider: "sqlite", schema }),
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128,
      disableSignUp: !config.registrationEnabled, autoSignIn: false },
    user: { additionalFields: {
      isInstanceAdmin: { type: "boolean", required: true, defaultValue: false, input: false },
    } },
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: new URL(config.origin).protocol === "https:" },
    rateLimit: { enabled: true, window: 60, max: 20 },
    disabledPaths: ["/is-username-available", "/request-password-reset", "/reset-password"],
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 30, immutableUsername: true })],
    hooks: { before: createAuthMiddleware(async (context) => {
      if (context.path === "/sign-up/email") {
        if (!config.registrationEnabled || !isInitialized(connection)) {
          throw new APIError("FORBIDDEN", { message: "Registration is unavailable. Ask your household admin." });
        }
        const parsed = identitySchema.safeParse(context.body);
        if (!parsed.success) throw new APIError("BAD_REQUEST", { message: "Check your display name, username, email, and password." });
        return { context: { ...context, body: { ...context.body, ...parsed.data } } };
      }
    }) },
  });
}

let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  auth ??= createAuth(getDatabase(), readAuthConfig());
  return auth;
}
