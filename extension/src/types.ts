export interface Trip {
  id: string
  name: string
  parks: Park[]           // index 0 = highest priority
  dateRanges: DateRange[]
  filters: Filters
  mode: 'notify' | 'hold' | 'autopay'
  status: 'idle' | 'scanning' | 'reserving' | 'reserved' | 'paid' | 'paused' | 'failed'
  lastMatch: MatchedSite | null
  attempted: string[]     // "parkId|checkIn|checkOut" dedup keys
  createdAt: number
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
  partySize: number
}

export type Theme = 'auto' | 'light' | 'dark'

export interface Settings {
  pollIntervalSeconds: 10 | 30 | 60 | 120
  debugMode: boolean
  theme: Theme
}

export interface ServerUser {
  id: string
  email: string
  name?: string
  role: string
}

export interface PendingAuthState {
  pendingStartTripId: string | null
}

export interface AuthState {
  token: string | null
  user: ServerUser | null
  lastEmail: string | null
}

export interface StorageData {
  trips: Trip[]
  payment: PaymentConfig | null
  settings: Settings
  debugLog: string[]
  auth: AuthState
}
