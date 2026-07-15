import type { DateRange, DebugLogEntry, Trip } from './types'

export const RuntimeMessageCode = {
  contentDebugLog: 7101,
  scanNow: 7102,
  stopScan: 7103,
  tripsChanged: 7104,
  matchFailed: 7105,
  bookingReserved: 7106,
  bookingConfirmed: 7107,
  bookingFailed: 7108,
  openAccountPage: 7109,
  getDecryptedPayment: 7110,
} as const

export const ResultCode = {
  found: 1211,
  reserved: 1212,
  booked: 1213,
  failed: 1214,
} as const

export const ProviderCode = {
  bcParks: 2301,
  parksCanada: 2302,
} as const

export const ProviderSnapshotSourceCode = {
  confirmationDom: 2401,
} as const

export const LogEventCode = {
  scanLeaseAcquired: 4101,
  bookingPaymentEventReported: 4102,
  bookingPaymentEventReportFailed: 4103,
  availabilityRaw: 4104,
  extensionConfigRefreshFailed: 4105,
  scanSkipped: 4106,
  extensionUpdateRequired: 4107,
  scanCycleStarted: 4108,
  serverAuthMissing: 4109,
  scanLeaseFailed: 4110,
  bcparksLoginMissing: 4111,
  tripScanStarted: 4112,
  parkChecked: 4113,
  availabilityResult: 4114,
  tripScanStopped: 4115,
  tripScanEmpty: 4116,
  tripScanError: 4117,
  serverResultReported: 4118,
  serverEmailSent: 4119,
  serverEmailNotSent: 4120,
  serverResultFailed: 4121,
  activeMatchSuppressed: 4122,
  siteFound: 4123,
  reservationTabOpened: 4124,
  notificationError: 4125,
  contentScriptLog: 4126,
  matchFailed: 4127,
  bookingReserved: 4128,
  serverEmailFailed: 4129,
  bookingPaid: 4130,
  bookingPaymentEventMissingMetadata: 4131,
  bookingFailed: 4132,
} as const

const TRIP_MODE_CODES: Record<Trip['mode'], number> = {
  alert: 3101,
  reserve: 3102,
  autopay: 3103,
}

const TRIP_STATUS_CODES: Record<Trip['status'], number> = {
  idle: 3201,
  scanning: 3202,
  reserving: 3203,
  reserved: 3204,
  paid: 3205,
  paused: 3206,
  failed: 3207,
}

const DATE_RANGE_CODES: Record<DateRange['type'], number> = {
  specific: 3301,
  recurring: 3302,
}

const BOOKING_STATUS_CODES = {
  found: 3401,
  reserved: 3402,
  paid: 3403,
  failed: 3404,
} as const

const LOG_MESSAGE_CODES: Record<string, number> = {
  'Scan lease acquired': 5101,
  'Booking payment event already reported': 5102,
  'Booking payment event reported': 5103,
  'Booking payment event reporting failed; will retry': 5104,
  'Raw availability response': 5105,
  'Extension config refresh failed': 5106,
  'Previous scan still running': 5107,
  'Scan skipped because this extension version is no longer supported': 5108,
  'Alarm fired': 5109,
  'Not signed in to server; skipping scan': 5110,
  'Could not acquire scan lease; skipping trip': 5111,
  'Not logged in to BC Parks; skipping reserve or auto-pay': 5112,
  'Scanning trip': 5113,
  'Checking park date window': 5114,
  '0 available site(s)': 5115,
  'Trip scan stopped': 5116,
  'No availability this cycle': 5117,
  'Error scanning trip': 5118,
  'Reporting found site result to server': 5119,
  'Site found result reporting failed': 5122,
  'Already handling active match; suppressing duplicate tab and notification': 5123,
  'Found reservable site': 5124,
  'Reservation tab opened': 5125,
  'Reservation tab opened for auto-pay': 5126,
  'Notification failed': 5127,
  'Content script log': 5128,
  'Match failed; marked attempted': 5129,
  'Match failed; retrying next scan': 5130,
  'Site reserved': 5131,
  'Reporting reservation result to server': 5132,
  'Reservation email sent': 5133,
  'Reservation email not sent': 5134,
  'Reservation email failed': 5135,
  'Booking paid': 5136,
  'Booking was paid, but matched site metadata was missing; cannot report point charge event': 5137,
  'Booking paid email sent': 5138,
  'Booking paid email not sent': 5139,
  'Booking paid result reporting failed': 5140,
  'Booking failed': 5141,
  'Booking failure email sent': 5142,
  'Booking failure email not sent': 5143,
  'Booking failure result reporting failed': 5144,
}

export interface EncodedDateRange {
  rangeTypeCode: number
  checkIn?: string
  checkOut?: string
  year?: number
  month?: number
  startDay?: number
  endDay?: number
}

export interface EncodedDebugLogEntry {
  ts: string
  level: DebugLogEntry['level']
  eventCode: number
  messageCode: number
  tripId?: string
  tripName?: string
  parkName?: string
  siteName?: string
  checkIn?: string
  checkOut?: string
  foundAt?: string
  reservedAt?: string
  paidAt?: string
  bookingDate?: string
  statusCode?: number
  error?: string
  metadata?: Record<string, unknown>
}

export function encodeTripMode(mode: Trip['mode']): number {
  return TRIP_MODE_CODES[mode]
}

export function encodeTripStatus(status: Trip['status']): number {
  return TRIP_STATUS_CODES[status]
}

export function encodeDateRange(range: DateRange): EncodedDateRange {
  if (range.type === 'specific') {
    return {
      rangeTypeCode: DATE_RANGE_CODES.specific,
      checkIn: range.checkIn,
      checkOut: range.checkOut,
    }
  }

  return {
    rangeTypeCode: DATE_RANGE_CODES.recurring,
    year: range.year,
    month: range.month,
    startDay: range.startDay,
    endDay: range.endDay,
  }
}

export function encodeDebugLogEntries(entries: DebugLogEntry[]): EncodedDebugLogEntry[] {
  return entries.map(entry => {
    const output: EncodedDebugLogEntry = {
      ts: entry.ts,
      level: entry.level,
      eventCode: entry.eventCode ?? 4999,
      messageCode: LOG_MESSAGE_CODES[entry.message] ?? 5999,
    }
    for (const field of [
      'tripId',
      'tripName',
      'parkName',
      'siteName',
      'checkIn',
      'checkOut',
      'foundAt',
      'reservedAt',
      'paidAt',
      'bookingDate',
      'error',
    ] as const) {
      if (typeof entry[field] === 'string') output[field] = entry[field]
    }
    if (entry.status) output.statusCode = BOOKING_STATUS_CODES[entry.status] ?? undefined
    if (entry.metadata && typeof entry.metadata === 'object') output.metadata = entry.metadata
    return output
  })
}

export async function opaqueHash(parts: Array<string | number | undefined | null>): Promise<string> {
  const data = new TextEncoder().encode(parts.map(part => part ?? '').join('\x1f'))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
