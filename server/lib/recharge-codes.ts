import crypto from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { pointTransactions, rechargeCodeRedemptions, rechargeCodes, user, userPointAccounts } from '@/db/schema';
import { sendEmail } from '@/lib/email';
import { logger } from '@/lib/loki';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_EXPIRY_DAYS = 30;

export type RechargeCodeStatus = 'active' | 'revoked' | 'expired' | 'fully_redeemed';

export type RechargeCodeListItem = {
  id: number;
  codePrefix: string;
  assignedEmail: string;
  assignedUserId: string | null;
  points: number;
  maxRedemptions: number;
  redeemedCount: number;
  status: RechargeCodeStatus;
  expiresAt: string | null;
  note: string | null;
  sentAt: string | null;
  lastSentAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type RechargeRedemptionListItem = {
  id: number;
  rechargeCodeId: number;
  userId: string;
  email: string;
  pointsGranted: number;
  createdAt: string;
};

export type CreateRechargeCodeInput = {
  assignedEmail: string;
  points: number;
  maxRedemptions?: number;
  expiresAt?: string | null;
  note?: string | null;
  sendNow?: boolean;
};

export type RedeemRechargeCodeResult = {
  pointsGranted: number;
  balanceAfter: number;
  redemptionId: number;
};

export class RechargeCodeError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

export function normalizeRechargeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new RechargeCodeError('invalid_email');
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RechargeCodeError('invalid_email');
  return email;
}

export function normalizeRechargeCode(value: unknown): string {
  if (typeof value !== 'string') throw new RechargeCodeError('invalid_code');
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^CS[A-Z0-9]{12,24}$/.test(normalized)) throw new RechargeCodeError('invalid_code');
  return normalized;
}

export function normalizePositiveInteger(value: unknown, field: string, fallback?: number): number {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new RechargeCodeError(`invalid_${field}`);
  }
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new RechargeCodeError(`invalid_${field}`);
  return number;
}

export function normalizeOptionalExpiry(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + DEFAULT_EXPIRY_DAYS);
    return date;
  }
  if (value === 'never') return null;
  if (typeof value !== 'string') throw new RechargeCodeError('invalid_expires_at');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T23:59:59.999Z`)
    : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RechargeCodeError('invalid_expires_at');
  return date;
}

export function normalizeOptionalNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new RechargeCodeError('invalid_note');
  const note = value.trim();
  return note ? note.slice(0, 500) : null;
}

export function generateRechargeCode(): string {
  let raw = 'CS';
  while (raw.length < 18) {
    const bytes = crypto.randomBytes(16);
    for (const byte of bytes) {
      raw += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (raw.length >= 18) break;
    }
  }
  return `${raw.slice(0, 2)}-${raw.slice(2, 6)}-${raw.slice(6, 10)}-${raw.slice(10, 14)}-${raw.slice(14, 18)}`;
}

export function codePrefixFor(code: string): string {
  const normalized = normalizeRechargeCode(code);
  return `${normalized.slice(0, 2)}-${normalized.slice(2, 6)}`;
}

export function hashRechargeCode(code: string): string {
  const secret = process.env.RECHARGE_CODE_SECRET || process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) throw new Error('RECHARGE_CODE_SECRET is required');
  return crypto.createHmac('sha256', secret).update(normalizeRechargeCode(code)).digest('hex');
}

export async function listRechargeCodes(): Promise<{
  codes: RechargeCodeListItem[];
  redemptions: RechargeRedemptionListItem[];
}> {
  const codeRows = await db.select({
    id: rechargeCodes.id,
    codePrefix: rechargeCodes.codePrefix,
    assignedEmail: rechargeCodes.assignedEmail,
    assignedUserId: rechargeCodes.assignedUserId,
    points: rechargeCodes.points,
    maxRedemptions: rechargeCodes.maxRedemptions,
    redeemedCount: rechargeCodes.redeemedCount,
    status: rechargeCodes.status,
    expiresAt: rechargeCodes.expiresAt,
    note: rechargeCodes.note,
    sentAt: rechargeCodes.sentAt,
    lastSentAt: rechargeCodes.lastSentAt,
    revokedAt: rechargeCodes.revokedAt,
    createdAt: rechargeCodes.createdAt,
  }).from(rechargeCodes)
    .orderBy(desc(rechargeCodes.createdAt));

  const redemptionRows = await db.select({
    id: rechargeCodeRedemptions.id,
    rechargeCodeId: rechargeCodeRedemptions.rechargeCodeId,
    userId: rechargeCodeRedemptions.userId,
    email: rechargeCodeRedemptions.email,
    pointsGranted: rechargeCodeRedemptions.pointsGranted,
    createdAt: rechargeCodeRedemptions.createdAt,
  }).from(rechargeCodeRedemptions)
    .orderBy(desc(rechargeCodeRedemptions.createdAt));

  return {
    codes: codeRows.map(row => ({
      ...row,
      status: displayStatus(row),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      sentAt: row.sentAt?.toISOString() ?? null,
      lastSentAt: row.lastSentAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    redemptions: redemptionRows.map(row => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function createRechargeCode(adminUserId: string, input: CreateRechargeCodeInput): Promise<{
  code: RechargeCodeListItem;
  plainCode: string;
  emailSent: boolean;
  emailError: string | null;
}> {
  const assignedEmail = normalizeRechargeEmail(input.assignedEmail);
  const points = normalizePositiveInteger(input.points, 'points');
  const maxRedemptions = normalizePositiveInteger(input.maxRedemptions, 'max_redemptions', 1);
  const expiresAt = normalizeOptionalExpiry(input.expiresAt);
  const note = normalizeOptionalNote(input.note);
  const plainCode = generateRechargeCode();
  const codeHash = hashRechargeCode(plainCode);
  const codePrefix = codePrefixFor(plainCode);
  const now = new Date();
  let emailSent = false;
  let emailError: string | null = null;

  const [assignedUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, assignedEmail));
  const [created] = await db.insert(rechargeCodes).values({
    codeHash,
    codePrefix,
    assignedEmail,
    assignedUserId: assignedUser?.id ?? null,
    points,
    maxRedemptions,
    status: 'active',
    expiresAt,
    note,
    createdByAdminId: adminUserId,
  }).returning();

  if (input.sendNow) {
    try {
      await sendRechargeCodeEmail({ to: assignedEmail, code: plainCode, points, expiresAt });
      await db.update(rechargeCodes)
        .set({ sentAt: now, lastSentAt: now, updatedAt: now })
        .where(eq(rechargeCodes.id, created.id));
      created.sentAt = now;
      created.lastSentAt = now;
      emailSent = true;
    } catch (err) {
      emailError = 'email_send_failed';
      logger.error('recharge_code.email_send_failed', '[recharge-code] email send failed', {
        rechargeCodeId: created.id,
        assignedEmail,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('recharge_code.created', '[recharge-code] created', {
    rechargeCodeId: created.id,
    assignedEmail,
    points,
    maxRedemptions,
    adminUserId,
  });

  return {
    plainCode,
    emailSent,
    emailError,
    code: {
      ...created,
      status: displayStatus(created),
      expiresAt: created.expiresAt?.toISOString() ?? null,
      sentAt: created.sentAt?.toISOString() ?? null,
      lastSentAt: created.lastSentAt?.toISOString() ?? null,
      revokedAt: created.revokedAt?.toISOString() ?? null,
      createdAt: created.createdAt.toISOString(),
    },
  };
}

export async function sendExistingRechargeCode(id: number, plainCode: string): Promise<void> {
  const [code] = await db.select().from(rechargeCodes).where(eq(rechargeCodes.id, id));
  if (!code) throw new RechargeCodeError('not_found', 404);
  if (code.status !== 'active') throw new RechargeCodeError('code_not_active');
  if (displayStatus(code) === 'expired') throw new RechargeCodeError('code_expired');
  if (hashRechargeCode(plainCode) !== code.codeHash) throw new RechargeCodeError('code_mismatch');

  await sendRechargeCodeEmail({
    to: code.assignedEmail,
    code: plainCode,
    points: code.points,
    expiresAt: code.expiresAt,
  });

  const now = new Date();
  await db.update(rechargeCodes)
    .set({ sentAt: code.sentAt ?? now, lastSentAt: now, updatedAt: now })
    .where(eq(rechargeCodes.id, id));
}

export async function revokeRechargeCode(id: number): Promise<void> {
  const now = new Date();
  const [updated] = await db.update(rechargeCodes)
    .set({ status: 'revoked', revokedAt: now, updatedAt: now })
    .where(eq(rechargeCodes.id, id))
    .returning({ id: rechargeCodes.id });
  if (!updated) throw new RechargeCodeError('not_found', 404);
}

export async function redeemRechargeCode(input: {
  code: unknown;
  userId: string;
  userEmail: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<RedeemRechargeCodeResult> {
  const normalizedCode = normalizeRechargeCode(input.code);
  const codeHash = hashRechargeCode(normalizedCode);
  const userEmail = normalizeRechargeEmail(input.userEmail);

  return db.transaction(async (tx) => {
    const lockedRows = await tx.execute(sql<{
      id: number;
      "codeHash": string;
      "codePrefix": string;
      "assignedEmail": string;
      "assignedUserId": string | null;
      points: number;
      "maxRedemptions": number;
      "redeemedCount": number;
      status: string;
      "expiresAt": Date | string | null;
    }>`
      select id, "codeHash", "codePrefix", "assignedEmail", "assignedUserId", points,
             "maxRedemptions", "redeemedCount", status, "expiresAt"
      from recharge_codes
      where "codeHash" = ${codeHash}
      for update
    `);
    const code = (lockedRows as unknown as Array<{
      id: number;
      codeHash: string;
      codePrefix: string;
      assignedEmail: string;
      assignedUserId: string | null;
      points: number;
      maxRedemptions: number;
      redeemedCount: number;
      status: string;
      expiresAt: Date | string | null;
    }>)[0];

    if (!code) throw new RechargeCodeError('invalid_code', 404);
    const expiresAt = dateValue(code.expiresAt);
    if (code.status !== 'active') throw new RechargeCodeError('code_not_active');
    if (expiresAt && expiresAt.getTime() <= Date.now()) throw new RechargeCodeError('code_expired');
    if (code.assignedEmail !== userEmail) throw new RechargeCodeError('email_mismatch', 403);
    if (code.assignedUserId && code.assignedUserId !== input.userId) throw new RechargeCodeError('email_mismatch', 403);
    const redeemedCount = Number(code.redeemedCount);
    const maxRedemptions = Number(code.maxRedemptions);
    const points = Number(code.points);
    if (redeemedCount >= maxRedemptions) throw new RechargeCodeError('code_fully_redeemed');

    const [existingRedemption] = await tx.select({ id: rechargeCodeRedemptions.id })
      .from(rechargeCodeRedemptions)
      .where(and(
        eq(rechargeCodeRedemptions.rechargeCodeId, code.id),
        eq(rechargeCodeRedemptions.userId, input.userId),
      ));
    if (existingRedemption && maxRedemptions === 1) throw new RechargeCodeError('already_redeemed');

    await tx.insert(userPointAccounts)
      .values({ userId: input.userId, balance: 0 })
      .onConflictDoNothing();

    const accountRows = await tx.execute(sql<{ userId: string; balance: number }>`
      select "userId", balance
      from user_point_accounts
      where "userId" = ${input.userId}
      for update
    `);
    const account = (accountRows as unknown as Array<{ userId: string; balance: number }>)[0];
    if (!account) throw new Error(`Point account not found for user ${input.userId}`);

    const [redemption] = await tx.insert(rechargeCodeRedemptions).values({
      rechargeCodeId: code.id,
      userId: input.userId,
      email: userEmail,
      pointsGranted: points,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    }).returning({ id: rechargeCodeRedemptions.id });

    const balanceAfter = Number(account.balance) + points;
    const [transaction] = await tx.insert(pointTransactions).values({
      userId: input.userId,
      type: 'recharge_code',
      pointsDelta: points,
      balanceAfter,
      sourceType: 'recharge_code_redemption',
      sourceId: String(redemption.id),
      idempotencyKey: `recharge_code:${code.id}:redemption:${redemption.id}`,
      metadata: {
        rechargeCodeId: code.id,
        codePrefix: code.codePrefix,
      },
    }).returning({ id: pointTransactions.id });

    await tx.update(rechargeCodeRedemptions)
      .set({ pointTransactionId: transaction.id })
      .where(eq(rechargeCodeRedemptions.id, redemption.id));
    await tx.update(userPointAccounts)
      .set({ balance: balanceAfter, updatedAt: new Date() })
      .where(eq(userPointAccounts.userId, input.userId));
    await tx.update(rechargeCodes)
      .set({
        redeemedCount: redeemedCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(rechargeCodes.id, code.id));

    logger.info('recharge_code.redeemed', '[recharge-code] redeemed', {
      rechargeCodeId: code.id,
      redemptionId: redemption.id,
      userId: input.userId,
      points,
      balanceAfter,
    });

    return {
      pointsGranted: points,
      balanceAfter,
      redemptionId: redemption.id,
    };
  });
}

function dateValue(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function displayStatus(row: {
  status: string;
  expiresAt: Date | null;
  redeemedCount: number;
  maxRedemptions: number;
}): RechargeCodeStatus {
  if (row.status === 'revoked') return 'revoked';
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return 'expired';
  if (row.redeemedCount >= row.maxRedemptions) return 'fully_redeemed';
  return 'active';
}

async function sendRechargeCodeEmail({
  to,
  code,
  points,
  expiresAt,
}: {
  to: string;
  code: string;
  points: number;
  expiresAt: Date | null;
}) {
  const { subject, html } = buildRechargeCodeEmail({ code, points, expiresAt });
  await sendEmail({ to, subject, html });
}

export function buildRechargeCodeEmail({
  code,
  points,
  expiresAt,
}: {
  code: string;
  points: number;
  expiresAt: Date | null;
}): { subject: string; html: string } {
  const expiry = expiresAt
    ? expiresAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : 'No expiration date';
  return {
    subject: `Your Campsoon recharge code: ${points.toLocaleString()} points`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:520px;margin:32px auto;color:#1a1a1a">
        <h2 style="color:#16a34a;margin-bottom:8px">Your Campsoon recharge code</h2>
        <p>Hi camper,</p>
        <p>Use this code in Campsoon to add <strong>${points.toLocaleString()} points</strong> to your account.</p>
        <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:12px;
                    padding:16px 20px;text-align:center;font-size:26px;font-weight:800;
                    letter-spacing:2px;margin:16px 0;color:#1a1a1a">
          ${escapeHtml(code)}
        </div>
        <p style="color:#4b5563;font-size:14px">Expires: <strong>${escapeHtml(expiry)}</strong></p>
        <p style="color:#6b7280;font-size:13px;margin-top:28px">
          If you did not request this code, you can ignore this email.
        </p>
      </div>
    `,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
