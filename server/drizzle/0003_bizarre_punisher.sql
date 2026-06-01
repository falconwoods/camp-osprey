ALTER TABLE "trips" ADD COLUMN "clientId" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "deletedAt" timestamp;--> statement-breakpoint
CREATE INDEX "trips_client_idx" ON "trips" USING btree ("clientId");