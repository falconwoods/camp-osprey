CREATE TABLE "booking_payment_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"tripId" text,
	"clientEventId" text,
	"idempotencyKey" text NOT NULL,
	"provider" text NOT NULL,
	"confirmationNumber" text,
	"providerReservationId" text,
	"providerTransactionId" text,
	"parkName" text NOT NULL,
	"campgroundName" text,
	"sectionName" text,
	"siteName" text NOT NULL,
	"resourceId" text,
	"checkIn" text NOT NULL,
	"checkOut" text NOT NULL,
	"paidAt" timestamp,
	"bookingUrl" text,
	"amountPaid" integer,
	"currency" text,
	"clientId" text,
	"ipAddress" text,
	"country" text,
	"region" text,
	"city" text,
	"userAgent" text,
	"platformOs" text,
	"platformArch" text,
	"extensionVersion" text,
	"rawProviderSnapshot" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_point_charges" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"bookingPaymentEventId" integer NOT NULL,
	"pointTransactionId" integer,
	"pointsCharged" integer NOT NULL,
	"status" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"pointsDelta" integer NOT NULL,
	"balanceAfter" integer NOT NULL,
	"sourceType" text NOT NULL,
	"sourceId" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_checkout_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"packageId" text NOT NULL,
	"stripePriceId" text NOT NULL,
	"stripeSessionId" text NOT NULL,
	"stripePaymentIntentId" text,
	"stripeCustomerId" text,
	"status" text NOT NULL,
	"points" integer NOT NULL,
	"amountTotal" integer,
	"currency" text,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"stripeEventId" text PRIMARY KEY NOT NULL,
	"eventType" text NOT NULL,
	"processedAt" timestamp,
	"status" text NOT NULL,
	"error" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_point_accounts" (
	"userId" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_payment_events" ADD CONSTRAINT "booking_payment_events_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_payment_events" ADD CONSTRAINT "booking_payment_events_tripId_trips_id_fk" FOREIGN KEY ("tripId") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_point_charges" ADD CONSTRAINT "booking_point_charges_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_point_charges" ADD CONSTRAINT "booking_point_charges_bookingPaymentEventId_booking_payment_events_id_fk" FOREIGN KEY ("bookingPaymentEventId") REFERENCES "public"."booking_payment_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_point_charges" ADD CONSTRAINT "booking_point_charges_pointTransactionId_point_transactions_id_fk" FOREIGN KEY ("pointTransactionId") REFERENCES "public"."point_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_checkout_sessions" ADD CONSTRAINT "stripe_checkout_sessions_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_point_accounts" ADD CONSTRAINT "user_point_accounts_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_payment_events_user_idx" ON "booking_payment_events" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "booking_payment_events_trip_idx" ON "booking_payment_events" USING btree ("tripId");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_payment_events_idempotency_idx" ON "booking_payment_events" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "booking_point_charges_user_idx" ON "booking_point_charges" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_point_charges_idempotency_idx" ON "booking_point_charges" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "point_transactions_user_idx" ON "point_transactions" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "point_transactions_idempotency_idx" ON "point_transactions" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "stripe_checkout_sessions_user_idx" ON "stripe_checkout_sessions" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_checkout_sessions_session_idx" ON "stripe_checkout_sessions" USING btree ("stripeSessionId");