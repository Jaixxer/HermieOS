import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://hermieos:hermieos@localhost:5432/hermieos',
  },
  casing: 'snake_case',
  verbose: true,
});
