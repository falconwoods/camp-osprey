CREATE TABLE "extension_configs" (
	"channel" text PRIMARY KEY NOT NULL,
	"latestVersion" text NOT NULL,
	"minSupportedVersion" text NOT NULL,
	"rolloutState" text DEFAULT 'hidden' NOT NULL,
	"pollIntervalSeconds" integer DEFAULT 600 NOT NULL,
	"downloadUrl" text,
	"forceUpdateMessage" text,
	"maintenanceEnabled" boolean DEFAULT false NOT NULL,
	"maintenanceMessage" text,
	"featureFlags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extraConfig" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"updatedBy" text
);
--> statement-breakpoint
CREATE TABLE "extension_heartbeats" (
	"clientId" text PRIMARY KEY NOT NULL,
	"userId" text,
	"channel" text NOT NULL,
	"extensionVersion" text,
	"extensionId" text,
	"browser" text,
	"locale" text,
	"userAgent" text,
	"platformOs" text,
	"platformArch" text,
	"ipAddress" text,
	"country" text,
	"region" text,
	"city" text,
	"firstSeenAt" timestamp DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extension_releases" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"version" text NOT NULL,
	"state" text DEFAULT 'hidden' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"changelogUrl" text,
	"publishedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extension_configs" ADD CONSTRAINT "extension_configs_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_heartbeats" ADD CONSTRAINT "extension_heartbeats_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_releases" ADD CONSTRAINT "extension_releases_channel_extension_configs_channel_fk" FOREIGN KEY ("channel") REFERENCES "public"."extension_configs"("channel") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extension_heartbeats_user_idx" ON "extension_heartbeats" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "extension_heartbeats_channel_idx" ON "extension_heartbeats" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "extension_heartbeats_last_seen_idx" ON "extension_heartbeats" USING btree ("lastSeenAt");--> statement-breakpoint
CREATE UNIQUE INDEX "extension_releases_channel_version_idx" ON "extension_releases" USING btree ("channel","version");--> statement-breakpoint
CREATE INDEX "extension_releases_channel_idx" ON "extension_releases" USING btree ("channel");--> statement-breakpoint
INSERT INTO "extension_configs" (
	"channel",
	"latestVersion",
	"minSupportedVersion",
	"rolloutState",
	"pollIntervalSeconds",
	"downloadUrl",
	"forceUpdateMessage"
) VALUES
	('chrome_store', '0.1.0', '0.1.0', 'hidden', 600, NULL, 'Please update campsoon to continue.'),
	('website', '0.1.0', '0.1.0', 'hidden', 600, 'https://campsoon.com', 'Please download the latest campsoon extension to continue.');
