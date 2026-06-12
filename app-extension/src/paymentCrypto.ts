import { getPaymentEncryptionKey } from './serverApi'
import type { EncryptedPaymentConfig, PaymentConfig, PlainPaymentConfig } from './types'

let cachedPaymentKey: { keyVersion: number; key: CryptoKey } | null = null

export function isEncryptedPaymentConfig(payment: PaymentConfig | null): payment is EncryptedPaymentConfig {
  return Boolean(
    payment &&
    'schemaVersion' in payment &&
    payment.schemaVersion === 2 &&
    typeof payment.encryptedPayload === 'string' &&
    typeof payment.iv === 'string',
  )
}

export function isPlainPaymentConfig(payment: PaymentConfig | null): payment is PlainPaymentConfig {
  return Boolean(
    payment &&
    'cardNumber' in payment &&
    typeof payment.cardNumber === 'string',
  )
}

export function hasSavedParkPayment(payment: PaymentConfig | null): payment is PaymentConfig {
  if (isPlainPaymentConfig(payment)) {
    return [
      payment.cardNumber,
      payment.cardHolder,
      payment.cardExpiry,
      payment.cardCvv,
      payment.billingAddress,
      payment.billingPostal,
    ].every(value => typeof value === 'string' && value.trim())
  }
  return Boolean(
    payment &&
    isEncryptedPaymentConfig(payment) &&
    payment.encryptedPayload &&
    payment.iv,
  )
}

export async function encryptParkPayment(payment: PlainPaymentConfig): Promise<EncryptedPaymentConfig> {
  const { keyVersion, key } = await getPaymentCryptoKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(JSON.stringify(payment))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(encoded))
  return {
    schemaVersion: 2,
    keyVersion,
    updatedAt: new Date().toISOString(),
    encryptedPayload: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  }
}

export async function decryptParkPayment(payment: PaymentConfig): Promise<PlainPaymentConfig> {
  if (isPlainPaymentConfig(payment)) return payment
  if (!isEncryptedPaymentConfig(payment)) throw new Error('invalid_payment_config')

  const { key } = await getPaymentCryptoKey(payment.keyVersion)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(payment.iv)) },
    key,
    toArrayBuffer(base64ToBytes(payment.encryptedPayload)),
  )
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as PlainPaymentConfig
  if (!isPlainPaymentConfig(parsed)) throw new Error('invalid_payment_payload')
  return parsed
}

async function getPaymentCryptoKey(expectedVersion?: number): Promise<{ keyVersion: number; key: CryptoKey }> {
  if (cachedPaymentKey && (!expectedVersion || cachedPaymentKey.keyVersion === expectedVersion)) {
    return cachedPaymentKey
  }
  const response = await getPaymentEncryptionKey()
  const keyBytes = base64ToBytes(response.key)
  if (keyBytes.byteLength !== 32) throw new Error('invalid_payment_key')
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), 'AES-GCM', false, ['encrypt', 'decrypt'])
  cachedPaymentKey = { keyVersion: response.keyVersion, key }
  return cachedPaymentKey
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
