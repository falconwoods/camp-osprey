export interface Trip {
  id: string
  clientId?: string
  name: string
  parks: Park[]           // index 0 = highest priority
  dateRanges: DateRange[]
  filters: Filters
  mode: 'alert' | 'hold' | 'autopay'
  status: 'idle' | 'scanning' | 'reserving' | 'reserved' | 'paid' | 'paused' | 'failed'
  lastMatch: MatchedSite | null
  attempted: string[]     // "parkId|checkIn|checkOut" dedup keys
  createdAt: number
  updatedAt?: number
  deletedAt?: number | null
}

export interface Park {
  id: string              // BC Parks resourceLocationId as string
  name: string
}

export interface Filters {
  noWalkin: boolean
  noDouble: boolean
}

export type DateRange =
  | { type: 'specific'; checkIn: string; checkOut: string }
  | { type: 'recurring'; year: number; month: number; startDay: number; endDay: number }
  // startDay/endDay: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun

export interface MatchedSite {
  parkName: string
  siteName: string
  sectionName: string
  checkIn: string         // ISO date YYYY-MM-DD
  checkOut: string        // ISO date YYYY-MM-DD
  bookingUrl: string
  resourceId: string
  availableCount?: number
  foundAt?: string        // ISO date-time
  reservedAt?: string     // ISO date-time
  paidAt?: string         // ISO date-time
}

export interface AvailableSite {
  resourceId: string
  campgroundId: string
  campgroundName: string
  sectionName: string
  siteName: string
  mapId: string
  isWalkin: boolean
  isDouble: boolean
  checkIn: string         // ISO date YYYY-MM-DD
  checkOut: string        // ISO date YYYY-MM-DD
  availableCount?: number
}

export interface PaymentConfig {
  cardNumber: string
  cardHolder: string
  cardExpiry: string      // "MM/YY"
  cardCvv: string
  billingAddress: string  // → #street-field-0
  billingPostal: string   // → #postal-code-field-0
}

export type Theme = 'auto' | 'light' | 'dark'

export interface Settings {
  pollIntervalSeconds: 10 | 30 | 60 | 120
  debugMode: boolean
  emailOnSiteFound: boolean
  theme: Theme
  logSyncMinLevel: LogLevel
}

export interface ServerUser {
  id: string
  email: string
  name?: string | null
  role: string
}

export interface PendingAuthState {
  pendingStartTripId: string | null
}

export interface AuthState {
  token: string | null
  user: ServerUser | null
  lastEmail: string | null
  pointsBalance?: number | null
}

export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

export type BookingStatus = 'found' | 'reserved' | 'paid' | 'failed'

export interface ClientInfo {
  extensionVersion?: string
  userAgent?: string
  platformOs?: string
  platformArch?: string
  platformNaclArch?: string
}

export interface DebugLogEntry {
  ts: string
  level: LogLevel
  event: string
  message: string
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
  status?: BookingStatus
  error?: string
  metadata?: Record<string, unknown>
}

export interface StorageData {
  clientId: string | null
  payment: PaymentConfig | null
  settings: Settings
  debugLog: DebugLogEntry[]
  auth: AuthState
}
