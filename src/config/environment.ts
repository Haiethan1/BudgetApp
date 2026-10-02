import { loadEnvConfig } from "@next/env";

// Match Next's environment-file precedence for host commands.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
