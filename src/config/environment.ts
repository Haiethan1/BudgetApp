import nextEnvironment from "@next/env";
import * as nextEnvironmentNamespace from "@next/env";

// Match Next's environment-file precedence for host commands.
// Native ESM sees the CommonJS default; tsx's CommonJS transform sees named exports.
const { loadEnvConfig } = nextEnvironment ?? nextEnvironmentNamespace;
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
