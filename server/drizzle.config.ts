import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

if (!process.env.DATABASE_URL) {
  dotenv.config({ path: '.env' });
}

export default defineConfig({
  schema: './db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  tablesFilter: ['user*', 'session*', 'account*', 'verification*', 'trips*', 'booking_results*'],
});
