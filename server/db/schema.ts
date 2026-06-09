import {
  pgTable, text, boolean, timestamp, serial,
  integer, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core';

// ── better-auth required tables ───────────────────────────────────────────────

export const user = pgTable('user', {
  id:            text('id').primaryKey(),
  name:          text('name'),
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
  clientId:    text('clientId'),
  name:        text('name').notNull(),
  parks:       jsonb('parks').notNull(),
  dateRanges:  jsonb('dateRanges').notNull(),
  filters:     jsonb('filters').notNull(),
  mode:        text('mode').notNull(),
  status:      text('status').notNull().default('idle'),
  lastMatch:   jsonb('lastMatch'),
  attempted:   text('attempted').array().notNull().default([]),
  deletedAt:   timestamp('deletedAt'),
  createdAt:   timestamp('createdAt').notNull().defaultNow(),
  updatedAt:   timestamp('updatedAt').notNull().defaultNow(),
}, (t) => [
  index('trips_user_idx').on(t.userId),
  index('trips_client_idx').on(t.clientId),
]);

export const bookingResults = pgTable('booking_results', {
  id:          serial('id').primaryKey(),
  tripId:      text('tripId').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  userId:      text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  outcome:     text('outcome').notNull(),
  matchedSite: jsonb('matchedSite'),
  error:       text('error'),
  emailSent:   boolean('emailSent').notNull().default(false),
  clientId:    text('clientId'),
  ipAddress:   text('ipAddress'),
  country:     text('country'),
  region:      text('region'),
  city:        text('city'),
  userAgent:   text('userAgent'),
  platformOs:  text('platformOs'),
  platformArch: text('platformArch'),
  extensionVersion: text('extensionVersion'),
  createdAt:   timestamp('createdAt').notNull().defaultNow(),
}, (t) => [
  index('booking_results_trip_idx').on(t.tripId),
  index('booking_results_user_idx').on(t.userId),
]);

export const userAuthEvents = pgTable('user_auth_events', {
  id:               serial('id').primaryKey(),
  userId:           text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  eventType:        text('eventType').notNull(),
  clientId:         text('clientId'),
  ipAddress:        text('ipAddress'),
  country:          text('country'),
  region:           text('region'),
  city:             text('city'),
  userAgent:        text('userAgent'),
  platformOs:       text('platformOs'),
  platformArch:     text('platformArch'),
  extensionVersion: text('extensionVersion'),
  createdAt:        timestamp('createdAt').notNull().defaultNow(),
}, (t) => [
  index('user_auth_events_user_idx').on(t.userId),
  index('user_auth_events_type_idx').on(t.eventType),
]);

export const userPointAccounts = pgTable('user_point_accounts', {
  userId:    text('userId').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  balance:   integer('balance').notNull().default(0),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

export const pointTransactions = pgTable('point_transactions', {
  id:             serial('id').primaryKey(),
  userId:         text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  type:           text('type').notNull(),
  pointsDelta:    integer('pointsDelta').notNull(),
  balanceAfter:   integer('balanceAfter').notNull(),
  sourceType:     text('sourceType').notNull(),
  sourceId:       text('sourceId').notNull(),
  idempotencyKey: text('idempotencyKey').notNull(),
  metadata:       jsonb('metadata'),
  createdAt:      timestamp('createdAt').notNull().defaultNow(),
}, (t) => [
  index('point_transactions_user_idx').on(t.userId),
  uniqueIndex('point_transactions_idempotency_idx').on(t.idempotencyKey),
]);

export const stripeCheckoutSessions = pgTable('stripe_checkout_sessions', {
  id:                    serial('id').primaryKey(),
  userId:                text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  packageId:             text('packageId').notNull(),
  stripePriceId:         text('stripePriceId').notNull(),
  stripeSessionId:       text('stripeSessionId').notNull(),
  stripePaymentIntentId: text('stripePaymentIntentId'),
  stripeCustomerId:      text('stripeCustomerId'),
  status:                text('status').notNull(),
  points:                integer('points').notNull(),
  amountTotal:           integer('amountTotal'),
  currency:              text('currency'),
  metadata:              jsonb('metadata'),
  createdAt:             timestamp('createdAt').notNull().defaultNow(),
  updatedAt:             timestamp('updatedAt').notNull().defaultNow(),
}, (t) => [
  index('stripe_checkout_sessions_user_idx').on(t.userId),
  uniqueIndex('stripe_checkout_sessions_session_idx').on(t.stripeSessionId),
]);

export const stripeWebhookEvents = pgTable('stripe_webhook_events', {
  stripeEventId: text('stripeEventId').primaryKey(),
  eventType:     text('eventType').notNull(),
  processedAt:   timestamp('processedAt'),
  status:        text('status').notNull(),
  error:         text('error'),
  createdAt:     timestamp('createdAt').notNull().defaultNow(),
  updatedAt:     timestamp('updatedAt').notNull().defaultNow(),
});

export const bookingPaymentEvents = pgTable('booking_payment_events', {
  id:                    serial('id').primaryKey(),
  userId:                text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  tripId:                text('tripId').references(() => trips.id, { onDelete: 'set null' }),
  clientEventId:         text('clientEventId'),
  idempotencyKey:        text('idempotencyKey').notNull(),
  provider:              text('provider').notNull(),
  confirmationNumber:    text('confirmationNumber'),
  providerReservationId: text('providerReservationId'),
  providerTransactionId: text('providerTransactionId'),
  parkName:              text('parkName').notNull(),
  campgroundName:        text('campgroundName'),
  sectionName:           text('sectionName'),
  siteName:              text('siteName').notNull(),
  resourceId:            text('resourceId'),
  checkIn:               text('checkIn').notNull(),
  checkOut:              text('checkOut').notNull(),
  paidAt:                timestamp('paidAt'),
  bookingUrl:            text('bookingUrl'),
  amountPaid:            integer('amountPaid'),
  currency:              text('currency'),
  clientId:              text('clientId'),
  ipAddress:             text('ipAddress'),
  country:               text('country'),
  region:                text('region'),
  city:                  text('city'),
  userAgent:             text('userAgent'),
  platformOs:            text('platformOs'),
  platformArch:          text('platformArch'),
  extensionVersion:      text('extensionVersion'),
  rawProviderSnapshot:   jsonb('rawProviderSnapshot'),
  createdAt:             timestamp('createdAt').notNull().defaultNow(),
}, (t) => [
  index('booking_payment_events_user_idx').on(t.userId),
  index('booking_payment_events_trip_idx').on(t.tripId),
  uniqueIndex('booking_payment_events_idempotency_idx').on(t.idempotencyKey),
]);

export const bookingPointCharges = pgTable('booking_point_charges', {
  id:                    serial('id').primaryKey(),
  userId:                text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  bookingPaymentEventId: integer('bookingPaymentEventId').notNull().references(() => bookingPaymentEvents.id, { onDelete: 'cascade' }),
  pointTransactionId:    integer('pointTransactionId').references(() => pointTransactions.id, { onDelete: 'set null' }),
  pointsCharged:         integer('pointsCharged').notNull(),
  status:                text('status').notNull(),
  idempotencyKey:        text('idempotencyKey').notNull(),
  createdAt:             timestamp('createdAt').notNull().defaultNow(),
}, (t) => [
  index('booking_point_charges_user_idx').on(t.userId),
  uniqueIndex('booking_point_charges_idempotency_idx').on(t.idempotencyKey),
]);

export const extensionConfigs = pgTable('extension_configs', {
  channel:             text('channel').primaryKey(),
  latestVersion:       text('latestVersion').notNull(),
  minSupportedVersion: text('minSupportedVersion').notNull(),
  rolloutState:        text('rolloutState').notNull().default('hidden'),
  pollIntervalSeconds: integer('pollIntervalSeconds').notNull().default(600),
  downloadUrl:         text('downloadUrl'),
  forceUpdateMessage:  text('forceUpdateMessage'),
  maintenanceEnabled:  boolean('maintenanceEnabled').notNull().default(false),
  maintenanceMessage:  text('maintenanceMessage'),
  featureFlags:        jsonb('featureFlags').notNull().default({}),
  extraConfig:         jsonb('extraConfig').notNull().default({}),
  createdAt:           timestamp('createdAt').notNull().defaultNow(),
  updatedAt:           timestamp('updatedAt').notNull().defaultNow(),
  updatedBy:           text('updatedBy').references(() => user.id, { onDelete: 'set null' }),
});

export const extensionReleases = pgTable('extension_releases', {
  id:           serial('id').primaryKey(),
  channel:      text('channel').notNull().references(() => extensionConfigs.channel, { onDelete: 'cascade' }),
  version:      text('version').notNull(),
  state:        text('state').notNull().default('hidden'),
  title:        text('title').notNull(),
  summary:      text('summary'),
  notes:        jsonb('notes').notNull().default([]),
  changelogUrl: text('changelogUrl'),
  publishedAt:  timestamp('publishedAt'),
  createdAt:    timestamp('createdAt').notNull().defaultNow(),
  updatedAt:    timestamp('updatedAt').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('extension_releases_channel_version_idx').on(t.channel, t.version),
  index('extension_releases_channel_idx').on(t.channel),
]);

export const extensionHeartbeats = pgTable('extension_heartbeats', {
  clientId:         text('clientId').primaryKey(),
  userId:           text('userId').references(() => user.id, { onDelete: 'set null' }),
  channel:          text('channel').notNull(),
  extensionVersion: text('extensionVersion'),
  extensionId:      text('extensionId'),
  browser:          text('browser'),
  locale:           text('locale'),
  userAgent:        text('userAgent'),
  platformOs:       text('platformOs'),
  platformArch:     text('platformArch'),
  ipAddress:        text('ipAddress'),
  country:          text('country'),
  region:           text('region'),
  city:             text('city'),
  firstSeenAt:      timestamp('firstSeenAt').notNull().defaultNow(),
  lastSeenAt:       timestamp('lastSeenAt').notNull().defaultNow(),
}, (t) => [
  index('extension_heartbeats_user_idx').on(t.userId),
  index('extension_heartbeats_channel_idx').on(t.channel),
  index('extension_heartbeats_last_seen_idx').on(t.lastSeenAt),
]);
