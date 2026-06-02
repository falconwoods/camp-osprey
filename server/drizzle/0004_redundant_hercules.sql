CREATE TABLE "user_auth_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"eventType" text NOT NULL,
	"clientId" text,
	"ipAddress" text,
	"country" text,
	"region" text,
	"city" text,
	"userAgent" text,
	"platformOs" text,
	"platformArch" text,
	"extensionVersion" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_results" ADD COLUMN "clientId" text;--> statement-breakpoint
ALTER TABLE "booking_results" ADD COLUMN "ipAddress" text;--> statement-breakpoint
ALTER TABLE "booking_results" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "booking_results" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "booking_results" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "booking_results" ADD COLUMN "userAgent" text;--> statement-breakpoint
ALTER TABLE "booking_results" ADD COLUMN "platformOs" text;--> statement-breakpoint
ALTER TABLE "booking_results" ADD COLUMN "platformArch" text;--> statement-breakpoint
ALTER TABLE "booking_results" ADD COLUMN "extensionVersion" text;--> statement-breakpoint
ALTER TABLE "user_auth_events" ADD CONSTRAINT "user_auth_events_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_auth_events_user_idx" ON "user_auth_events" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "user_auth_events_type_idx" ON "user_auth_events" USING btree ("eventType");