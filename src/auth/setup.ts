import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";

import { getDatabase, type openDatabase } from "../db/client";
import { account, instanceSetup, user } from "../db/schema";
import { type AuthConfig } from "./config";
import { identitySchema } from "./identity";
import { isInitialized } from "./server";

const setupSchema = identitySchema.extend({ setupToken: z.string().max(1024) });
export class SetupError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function initializeInstance(input: unknown, config: AuthConfig, connection: ReturnType<typeof openDatabase> = getDatabase()) {
  if (isInitialized(connection)) throw new SetupError("Setup is already complete. Sign in instead.", 409);
  if (!config.setupToken) throw new SetupError("Ask the host admin to configure the setup token.", 403);
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) throw new SetupError("Check the account fields and password rules.", 400);
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(parsed.data.setupToken), digest(config.setupToken))) {
    throw new SetupError("The setup token is invalid.", 403);
  }
  const password = await hashPassword(parsed.data.password);
  const id = randomUUID();
  const now = new Date();
  connection.sqlite.transaction(() => {
    if (isInitialized(connection)) throw new SetupError("Setup is already complete. Sign in instead.", 409);
    connection.db.insert(user).values({ id, name: parsed.data.name, email: parsed.data.email,
      username: parsed.data.username.toLowerCase(), displayUsername: parsed.data.username,
      emailVerified: false, isInstanceAdmin: true, createdAt: now, updatedAt: now }).run();
    connection.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id,
      providerId: "credential", password, createdAt: now, updatedAt: now }).run();
    connection.db.insert(instanceSetup).values({ key: "instance", adminId: id, completedAt: now }).run();
  }).immediate();
  return { id };
}

export async function handleSetup(request: Request, config: AuthConfig, connection: ReturnType<typeof openDatabase> = getDatabase()) {
  if (request.headers.get("origin") !== config.origin) return Response.json({ message: "Open setup from this Homebooks instance." }, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ message: "Invalid request." }, { status: 415 });
  try {
    const body = await request.text();
    if (body.length > 8192) return Response.json({ message: "Invalid request." }, { status: 413 });
    await initializeInstance(JSON.parse(body), config, connection);
    return Response.json({ message: "Setup complete. Sign in to continue." }, { status: 201 });
  } catch (error) {
    if (error instanceof SetupError) return Response.json({ message: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return Response.json({ message: "Invalid request." }, { status: 400 });
    return Response.json({ message: "Setup could not finish. Check the account details and try again." }, { status: 400 });
  }
}
