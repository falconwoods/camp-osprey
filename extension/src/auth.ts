import type { AuthState, ServerUser } from './types'
import { clearAuthSession, getAuth, getClientId, saveAuth } from './storage'
import { getClientInfo, serverFetch } from './serverApi'

export interface RequestCodeInput {
  email: string
}

export interface VerifyCodeInput {
  email: string
  code: string
}

export async function requestCode(input: RequestCodeInput): Promise<{ ok: true; isNewUser: boolean }> {
  const [clientId, clientInfo] = await Promise.all([getClientId(), getClientInfo()])
  return serverFetch('/api/extension-auth/request-code', {
    method: 'POST',
    body: JSON.stringify({ ...input, clientId, clientInfo }),
  })
}

type AuthResponse = {
  token: string
  user: ServerUser
  pointsBalance?: number
}

type UserResponse = ServerUser & {
  pointsBalance?: number
}

function pointsBalanceFromResponse(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export async function verifyCode(input: VerifyCodeInput): Promise<AuthResponse> {
  const [clientId, clientInfo] = await Promise.all([getClientId(), getClientInfo()])
  const result = await serverFetch<AuthResponse>('/api/extension-auth/verify-code', {
    method: 'POST',
    body: JSON.stringify({ ...input, clientId, clientInfo }),
  })
  await saveAuth({
    token: result.token,
    user: result.user,
    lastEmail: result.user.email,
    pointsBalance: pointsBalanceFromResponse(result.pointsBalance),
  })
  return result
}

export async function validateAuth(): Promise<boolean> {
  const auth = await getAuth()
  if (!auth.token) return false

  try {
    const user = await serverFetch<UserResponse>('/api/user', { method: 'GET', auth: true })
    const { pointsBalance, ...serverUser } = user
    const latestAuth = await getAuth()
    const nextAuth: AuthState = {
      token: latestAuth.token ?? auth.token,
      user: serverUser,
      lastEmail: serverUser.email,
      pointsBalance: pointsBalanceFromResponse(pointsBalance),
    }
    await saveAuth(nextAuth)
    return true
  } catch {
    await clearAuthSession()
    return false
  }
}

export async function signOut(): Promise<void> {
  await clearAuthSession()
}
