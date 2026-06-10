type Outcome = 'found' | 'hold_placed' | 'booked' | 'failed';
type Provider = 'bc_parks';

const RESULT_BY_CODE: Record<number, Outcome> = {
  1211: 'found',
  1212: 'hold_placed',
  1213: 'booked',
  1214: 'failed',
};

const MODE_BY_CODE: Record<number, string> = {
  3101: 'alert',
  3102: 'hold',
  3103: 'autopay',
};

const STATUS_BY_CODE: Record<number, string> = {
  3201: 'idle',
  3202: 'scanning',
  3203: 'reserving',
  3204: 'reserved',
  3205: 'paid',
  3206: 'paused',
  3207: 'failed',
};

const DATE_RANGE_TYPE_BY_CODE: Record<number, string> = {
  3301: 'specific',
  3302: 'recurring',
};

const BOOKING_STATUS_BY_CODE: Record<number, string> = {
  3401: 'found',
  3402: 'reserved',
  3403: 'paid',
  3404: 'failed',
};

const PROVIDER_BY_CODE: Record<number, Provider> = {
  2301: 'bc_parks',
};

const SNAPSHOT_SOURCE_BY_CODE: Record<number, string> = {
  2401: 'bcparks_confirmation_dom',
};

const LOG_EVENT_BY_CODE: Record<number, string> = {
  4101: 'scan_lease_acquired',
  4102: 'booking_payment_event_reported',
  4103: 'booking_payment_event_report_failed',
  4104: 'availability_raw',
  4105: 'extension_config_refresh_failed',
  4106: 'scan_skipped',
  4107: 'extension_update_required',
  4108: 'scan_cycle_started',
  4109: 'server_auth_missing',
  4110: 'scan_lease_failed',
  4111: 'bcparks_login_missing',
  4112: 'trip_scan_started',
  4113: 'park_checked',
  4114: 'availability_result',
  4115: 'trip_scan_stopped',
  4116: 'trip_scan_empty',
  4117: 'trip_scan_error',
  4118: 'server_result_reported',
  4119: 'server_email_sent',
  4120: 'server_email_not_sent',
  4121: 'server_result_failed',
  4122: 'active_match_suppressed',
  4123: 'site_found',
  4124: 'reservation_tab_opened',
  4125: 'notification_error',
  4126: 'content_script_log',
  4127: 'match_failed',
  4128: 'booking_reserved',
  4129: 'server_email_failed',
  4130: 'booking_paid',
  4131: 'booking_payment_event_missing_metadata',
  4132: 'booking_failed',
};

const LOG_MESSAGE_BY_CODE: Record<number, string> = {
  5101: 'Scan lease acquired',
  5102: 'Booking payment event already reported',
  5103: 'Booking payment event reported',
  5104: 'Booking payment event reporting failed; will retry',
  5105: 'Raw availability response',
  5106: 'Extension config refresh failed',
  5107: 'Previous scan still running',
  5108: 'Scan skipped because this extension version is no longer supported',
  5109: 'Alarm fired',
  5110: 'Not signed in to server; skipping scan',
  5111: 'Could not acquire scan lease; skipping trip',
  5112: 'Not logged in to BC Parks; skipping hold or auto-pay',
  5113: 'Scanning trip',
  5114: 'Checking park date window',
  5115: '0 available site(s)',
  5116: 'Trip scan stopped',
  5117: 'No availability this cycle',
  5118: 'Error scanning trip',
  5119: 'Reporting found site result to server',
  5120: 'Site found email sent',
  5121: 'Site found email not sent',
  5122: 'Site found result reporting failed',
  5123: 'Already handling active match; suppressing duplicate tab and notification',
  5124: 'Found reservable site',
  5125: 'Reservation tab opened',
  5126: 'Reservation tab opened for auto-pay',
  5127: 'Notification failed',
  5128: 'Content script log',
  5129: 'Match failed; marked attempted',
  5130: 'Match failed; retrying next scan',
  5131: 'Reservation held',
  5132: 'Reporting reservation result to server',
  5133: 'Reservation email sent',
  5134: 'Reservation email not sent',
  5135: 'Reservation email failed',
  5136: 'Booking paid',
  5137: 'Booking was paid, but matched site metadata was missing; cannot report point charge event',
  5138: 'Booking paid email sent',
  5139: 'Booking paid email not sent',
  5140: 'Booking paid result reporting failed',
  5141: 'Booking failed',
  5142: 'Booking failure email sent',
  5143: 'Booking failure email not sent',
  5144: 'Booking failure result reporting failed',
  5999: 'Extension event',
};

function numberField(input: Record<string, unknown>, field: string): number | undefined {
  const value = input[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function decodeResultOutcome(body: Record<string, unknown>): Outcome {
  const code = numberField(body, 'resultCode');
  if (code !== undefined) {
    const outcome = RESULT_BY_CODE[code];
    if (!outcome) throw new Error('invalid_result_code');
    return outcome;
  }

  const legacy = body.outcome;
  if (legacy === 'found' || legacy === 'hold_placed' || legacy === 'booked' || legacy === 'failed') return legacy;
  throw new Error('invalid_result_code');
}

export function decodeTripMode(body: Record<string, unknown>, fallback?: unknown): string | undefined {
  const code = numberField(body, 'modeCode');
  if (code !== undefined) return MODE_BY_CODE[code];
  return typeof fallback === 'string' ? fallback : undefined;
}

export function decodeTripStatus(body: Record<string, unknown>, fallback?: unknown): string | undefined {
  const code = numberField(body, 'statusCode');
  if (code !== undefined) return STATUS_BY_CODE[code];
  return typeof fallback === 'string' ? fallback : undefined;
}

export function decodeDateRanges(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const input = item as Record<string, unknown>;
    const rangeTypeCode = numberField(input, 'rangeTypeCode');
    if (rangeTypeCode === undefined) return item;
    const type = DATE_RANGE_TYPE_BY_CODE[rangeTypeCode];
    if (!type) return item;
    const { rangeTypeCode: _rangeTypeCode, ...rest } = input;
    return { ...rest, type };
  });
}

export function decodeProvider(body: Record<string, unknown>): Provider | undefined {
  const code = numberField(body, 'providerCode');
  if (code !== undefined) return PROVIDER_BY_CODE[code];
  const legacy = body.provider;
  return legacy === 'bc_parks' ? legacy : undefined;
}

export function decodeRawProviderSnapshot(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  const sourceCode = numberField(input, 'sourceCode');
  if (sourceCode === undefined) return value;
  const { sourceCode: _sourceCode, ...rest } = input;
  return {
    ...rest,
    source: SNAPSHOT_SOURCE_BY_CODE[sourceCode] ?? 'unknown',
  };
}

export function decodeExtensionLogEvent(value: unknown): string | undefined {
  if (typeof value === 'number') return LOG_EVENT_BY_CODE[value] ?? 'unknown_extension_event';
  return undefined;
}

export function decodeExtensionLogMessage(value: unknown): string | undefined {
  if (typeof value === 'number') return LOG_MESSAGE_BY_CODE[value] ?? 'Extension event';
  return undefined;
}

export function decodeExtensionLogStatus(value: unknown): string | undefined {
  if (typeof value === 'number') return BOOKING_STATUS_BY_CODE[value];
  return undefined;
}
