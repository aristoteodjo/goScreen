import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { Pool } from "pg";

export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      // Written only by the billing webhook, never by the client.
      plan: { type: "string", defaultValue: "free", input: false },
    },
  },
  plugins: [tanstackStartCookies()],
});
