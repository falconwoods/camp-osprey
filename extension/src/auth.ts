import type { ServerUser } from './types'
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

export async function verifyCode(input: VerifyCodeInput): Promise<{ token: string; user: ServerUser }> {
  const [clientId, clientInfo] = await Promise.all([getClientId(), getClientInfo()])
  const result = await serverFetch<{ token: string; user: ServerUser }>('/api/extension-auth/verify-code', {
    method: 'POST',
    body: JSON.stringify({ ...input, clientId, clientInfo }),
  })
  await saveAuth({ token: result.token, user: result.user, lastEmail: result.user.email })
  return result
}

export async function validateAuth(): Promise<boolean> {
  const auth = await getAuth()
  if (!auth.token) return false

  try {
    const user = await serverFetch<ServerUser>('/api/user', { method: 'GET', auth: true })
    const latestAuth = await getAuth()
    await saveAuth({ token: latestAuth.token ?? auth.token, user, lastEmail: user.email })
    return true
  } catch {
    await clearAuthSession()
    return false
  }
}

export async function signOut(): Promise<void> {
  await clearAuthSession()
}
