import { NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { extensionConfigs, extensionReleases } from '@/db/schema';
import { requireAdminAuth } from '@/lib/admin-auth';
import { normalizeExtensionChannel } from '@/lib/extension-config';

function inputRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function notesField(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
    : [];
}

function publishedAtField(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function ensureChannelExists(channel: string): Promise<boolean> {
  const [config] = await db
    .select({ channel: extensionConfigs.channel })
    .from(extensionConfigs)
    .where(eq(extensionConfigs.channel, channel))
    .limit(1);
  return Boolean(config);
}

async function listReleaseResponse(channel: ReturnType<typeof normalizeExtensionChannel>) {
  const releases = await db
    .select()
    .from(extensionReleases)
    .where(eq(extensionReleases.channel, channel))
    .orderBy(desc(extensionReleases.publishedAt), desc(extensionReleases.createdAt));

  return NextResponse.json({
    releases: releases.map(release => ({
      ...release,
      publishedAt: release.publishedAt?.toISOString() ?? null,
      createdAt: release.createdAt.toISOString(),
      updatedAt: release.updatedAt.toISOString(),
    })),
  });
}

export async function GET(request: Request) {
  const admin = await requireAdminAuth();
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const channel = normalizeExtensionChannel(url.searchParams.get('channel'));
  return listReleaseResponse(channel);
}

export async function POST(request: Request) {
  const admin = await requireAdminAuth();
  if (!admin.ok) return admin.response;

  const input = inputRecord(await request.json().catch(() => ({})));
  const channel = normalizeExtensionChannel(input.channel);
  const version = stringField(input, 'version');
  const state = stringField(input, 'state') ?? 'hidden';
  const title = stringField(input, 'title');
  const now = new Date();

  if (!version) return NextResponse.json({ error: 'version_required' }, { status: 400 });
  if (!title) return NextResponse.json({ error: 'title_required' }, { status: 400 });
  if (!['hidden', 'available', 'paused'].includes(state)) {
    return NextResponse.json({ error: 'invalid_rollout_state' }, { status: 400 });
  }
  if (!await ensureChannelExists(channel)) {
    return NextResponse.json({ error: 'extension_config_required' }, { status: 400 });
  }

  await db.insert(extensionReleases).values({
    channel,
    version,
    state,
    title,
    summary: stringField(input, 'summary'),
    notes: notesField(input.notes),
    changelogUrl: stringField(input, 'changelogUrl'),
    publishedAt: publishedAtField(input.publishedAt) ?? now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [extensionReleases.channel, extensionReleases.version],
    set: {
      state,
      title,
      summary: stringField(input, 'summary') ?? null,
      notes: notesField(input.notes),
      changelogUrl: stringField(input, 'changelogUrl') ?? null,
      publishedAt: publishedAtField(input.publishedAt) ?? now,
      updatedAt: sql`now()`,
    },
  });

  return listReleaseResponse(channel);
}

export async function DELETE(request: Request) {
  const admin = await requireAdminAuth();
  if (!admin.ok) return admin.response;

  const input = inputRecord(await request.json().catch(() => ({})));
  const channel = normalizeExtensionChannel(input.channel);
  const version = stringField(input, 'version');

  if (!version) return NextResponse.json({ error: 'version_required' }, { status: 400 });

  await db
    .delete(extensionReleases)
    .where(and(
      eq(extensionReleases.channel, channel),
      eq(extensionReleases.version, version),
    ));

  return listReleaseResponse(channel);
}
