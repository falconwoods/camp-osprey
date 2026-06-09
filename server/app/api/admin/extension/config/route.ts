import { NextResponse } from 'next/server';
import { db } from '@/db';
import { extensionConfigs, extensionReleases } from '@/db/schema';
import { requireAdminAuth } from '@/lib/admin-auth';
import { getExtensionConfigResponse, normalizeExtensionChannel } from '@/lib/extension-config';
import { sql } from 'drizzle-orm';

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanField(input: Record<string, unknown>, key: string): boolean | undefined {
  return typeof input[key] === 'boolean' ? input[key] : undefined;
}

function integerField(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function recordField(input: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = input[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function notesField(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
    : [];
}

export async function PUT(request: Request) {
  const admin = await requireAdminAuth();
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const input = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const channel = normalizeExtensionChannel(input.channel);
  const now = new Date();
  const latestVersion = stringField(input, 'latestVersion');
  const minSupportedVersion = stringField(input, 'minSupportedVersion');
  const rolloutState = stringField(input, 'rolloutState');
  const pollIntervalSeconds = integerField(input, 'pollIntervalSeconds');

  if (!latestVersion || !minSupportedVersion) {
    return NextResponse.json({ error: 'latestVersion_and_minSupportedVersion_required' }, { status: 400 });
  }
  if (rolloutState && !['hidden', 'available', 'paused'].includes(rolloutState)) {
    return NextResponse.json({ error: 'invalid_rollout_state' }, { status: 400 });
  }

  await db.insert(extensionConfigs).values({
    channel,
    latestVersion,
    minSupportedVersion,
    rolloutState: rolloutState ?? 'hidden',
    pollIntervalSeconds: pollIntervalSeconds ?? 600,
    downloadUrl: stringField(input, 'downloadUrl'),
    forceUpdateMessage: stringField(input, 'forceUpdateMessage'),
    maintenanceEnabled: booleanField(input, 'maintenanceEnabled') ?? false,
    maintenanceMessage: stringField(input, 'maintenanceMessage'),
    featureFlags: recordField(input, 'featureFlags') ?? {},
    extraConfig: recordField(input, 'extraConfig') ?? {},
    updatedAt: now,
    updatedBy: admin.userId,
  }).onConflictDoUpdate({
    target: extensionConfigs.channel,
    set: {
      latestVersion,
      minSupportedVersion,
      rolloutState: rolloutState ?? 'hidden',
      pollIntervalSeconds: pollIntervalSeconds ?? 600,
      downloadUrl: stringField(input, 'downloadUrl') ?? null,
      forceUpdateMessage: stringField(input, 'forceUpdateMessage') ?? null,
      maintenanceEnabled: booleanField(input, 'maintenanceEnabled') ?? false,
      maintenanceMessage: stringField(input, 'maintenanceMessage') ?? null,
      featureFlags: recordField(input, 'featureFlags') ?? {},
      extraConfig: recordField(input, 'extraConfig') ?? {},
      updatedAt: sql`now()`,
      updatedBy: admin.userId,
    },
  });

  const release = recordField(input, 'releaseNote');
  if (release) {
    await db.insert(extensionReleases).values({
      channel,
      version: stringField(release, 'version') ?? latestVersion,
      state: stringField(release, 'state') ?? rolloutState ?? 'hidden',
      title: stringField(release, 'title') ?? 'Update available',
      summary: stringField(release, 'summary'),
      notes: notesField(release.notes),
      changelogUrl: stringField(release, 'changelogUrl'),
      publishedAt: release.publishedAt && typeof release.publishedAt === 'string'
        ? new Date(release.publishedAt)
        : now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [extensionReleases.channel, extensionReleases.version],
      set: {
        state: stringField(release, 'state') ?? rolloutState ?? 'hidden',
        title: stringField(release, 'title') ?? 'Update available',
        summary: stringField(release, 'summary') ?? null,
        notes: notesField(release.notes),
        changelogUrl: stringField(release, 'changelogUrl') ?? null,
        publishedAt: release.publishedAt && typeof release.publishedAt === 'string'
          ? new Date(release.publishedAt)
          : now,
        updatedAt: sql`now()`,
      },
    });
  }

  return NextResponse.json(await getExtensionConfigResponse(channel));
}
