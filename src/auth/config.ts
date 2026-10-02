import { z } from "zod";
import "../config/environment";

const configuration = z.object({
  BETTER_AUTH_URL: z.url().refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.pathname === "/" && !url.search && !url.hash;
  }, "BETTER_AUTH_URL must be an HTTP(S) origin."),
  BETTER_AUTH_SECRET: z.string().min(32),
  HOMEBOOKS_SETUP_TOKEN: z.preprocess((value) => value === "" ? undefined : value, z.string().min(32).optional()),
  HOMEBOOKS_REGISTRATION_ENABLED: z.enum(["true", "false"]).default("false"),
});

export function readAuthConfig(environment: NodeJS.ProcessEnv = process.env) {
  const result = configuration.safeParse(environment);
  if (!result.success) throw new Error("Set BETTER_AUTH_URL, a 32-character auth secret, and valid registration/setup configuration. See README.md.");
  return {
    origin: new URL(result.data.BETTER_AUTH_URL).origin,
    secret: result.data.BETTER_AUTH_SECRET,
    setupToken: result.data.HOMEBOOKS_SETUP_TOKEN,
    registrationEnabled: result.data.HOMEBOOKS_REGISTRATION_ENABLED === "true",
  };
}

export type AuthConfig = ReturnType<typeof readAuthConfig>;
