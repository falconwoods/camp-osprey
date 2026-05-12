import {
  pgTable, text, boolean, timestamp, serial,
  integer, jsonb, index,
} from 'drizzle-orm/pg-core';

// ── better-auth required tables ───────────────────────────────────────────────

export const user = pgTable('user', {
  id:            text('id').primaryKey(),
  name:          text('name').notNull(),
  email:         text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull(),
  image:         text('image'),
  createdAt:     timestamp('createdAt').notNull(),
  updatedAt:     timestamp('updatedAt').notNull(),
  role:          text('role'),
  banned:        boolean('banned'),
  banReason:     text('banReason'),
  banExpires:    timestamp('banExpires'),
});

export const session = pgTable('session', {
  id:             text('id').primaryKey(),
  userId:         text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token:          text('token').notNull().unique(),
  expiresAt:      timestamp('expiresAt').notNull(),
  ipAddress:      text('ipAddress'),
  userAgent:      text('userAgent'),
  createdAt:      timestamp('createdAt').notNull(),
  updatedAt:      timestamp('updatedAt').notNull(),
  impersonatedBy: text('impersonatedBy'),
});

export const account = pgTable('account', {
  id:                    text('id').primaryKey(),
  userId:                text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId:             text('accountId').notNull(),
  providerId:            text('providerId').notNull(),
  accessToken:           text('accessToken'),
  refreshToken:          text('refreshToken'),
  accessTokenExpiresAt:  timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope:                 text('scope'),
  idToken:               text('idToken'),
  password:              text('password'),
  createdAt:             timestamp('createdAt').notNull(),
  updatedAt:             timestamp('updatedAt').notNull(),
});

export const verification = pgTable('verification', {
  id:         text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value:      text('value').notNull(),
  expiresAt:  timestamp('expiresAt').notNull(),
  createdAt:  timestamp('createdAt'),
  updatedAt:  timestamp('updatedAt'),
});

// ── Application tables ────────────────────────────────────────────────────────

export const trips = pgTable('trips', {
  id:          text('id').primaryKey(),
  userId:      text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  parks:       jsonb('parks').notNull(),
  dateRanges:  jsonb('dateRanges').notNull(),
  filters:     jsonb('filters').notNull(),
  mode:        text('mode').notNull(),
  status:      text('status').notNull().default('idle'),
  lastMatch:   jsonb('lastMatch'),
  attempted:   text('attempted').array().notNull().default([]),
  createdAt:   timestamp('createdAt').notNull().defaultNow(),
  updatedAt:   timestamp('updatedAt').notNull().defaultNow(),
}, (t) => [
  index('trips_user_idx').on(t.userId),
]);

export const bookingResults = pgTable('booking_results', {
  id:          serial('id').primaryKey(),
  tripId:      text('tripId').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  userId:      text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  outcome:     text('outcome').notNull(),
  matchedSite: jsonb('matchedSite'),
  error:       text('error'),
  emailSent:   boolean('emailSent').notNull().default(false),
  createdAt:   timestamp('createdAt').notNull().defaultNow(),
}, (t) => [
  index('booking_results_trip_idx').on(t.tripId),
  index('booking_results_user_idx').on(t.userId),
]);
