CREATE TABLE "recharge_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"codeHash" text NOT NULL,
	"codePrefix" text NOT NULL,
	"assignedEmail" text NOT NULL,
	"assignedUserId" text,
	"points" integer NOT NULL,
	"maxRedemptions" integer DEFAULT 1 NOT NULL,
	"redeemedCount" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expiresAt" timestamp,
	"note" text,
	"createdByAdminId" text NOT NULL,
	"sentAt" timestamp,
	"lastSentAt" timestamp,
	"revokedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recharge_code_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"rechargeCodeId" integer NOT NULL,
	"userId" text NOT NULL,
	"email" text NOT NULL,
	"pointsGranted" integer NOT NULL,
	"pointTransactionId" integer,
	"ipAddress" text,
	"userAgent" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recharge_codes" ADD CONSTRAINT "recharge_codes_assignedUserId_user_id_fk" FOREIGN KEY ("assignedUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recharge_codes" ADD CONSTRAINT "recharge_codes_createdByAdminId_user_id_fk" FOREIGN KEY ("createdByAdminId") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recharge_code_redemptions" ADD CONSTRAINT "recharge_code_redemptions_rechargeCodeId_recharge_codes_id_fk" FOREIGN KEY ("rechargeCodeId") REFERENCES "public"."recharge_codes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recharge_code_redemptions" ADD CONSTRAINT "recharge_code_redemptions_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recharge_code_redemptions" ADD CONSTRAINT "recharge_code_redemptions_pointTransactionId_point_transactions_id_fk" FOREIGN KEY ("pointTransactionId") REFERENCES "public"."point_transactions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "recharge_codes_hash_idx" ON "recharge_codes" USING btree ("codeHash");
--> statement-breakpoint
CREATE INDEX "recharge_codes_email_idx" ON "recharge_codes" USING btree ("assignedEmail");
--> statement-breakpoint
CREATE INDEX "recharge_codes_status_idx" ON "recharge_codes" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "recharge_codes_created_idx" ON "recharge_codes" USING btree ("createdAt");
--> statement-breakpoint
CREATE INDEX "recharge_code_redemptions_code_idx" ON "recharge_code_redemptions" USING btree ("rechargeCodeId");
--> statement-breakpoint
CREATE INDEX "recharge_code_redemptions_user_idx" ON "recharge_code_redemptions" USING btree ("userId");
