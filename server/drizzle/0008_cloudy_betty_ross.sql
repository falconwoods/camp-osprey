CREATE TABLE "user_payment_keys" (
	"userId" text PRIMARY KEY NOT NULL,
	"keyVersion" integer DEFAULT 1 NOT NULL,
	"key" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_payment_keys" ADD CONSTRAINT "user_payment_keys_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;