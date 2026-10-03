import { defineConfig } from "drizzle-kit";
import "./src/config/environment";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./data/homebooks.sqlite",
  },
  strict: true,
  verbose: true,
});
