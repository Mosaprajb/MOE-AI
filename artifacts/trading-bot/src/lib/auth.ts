// MOE-AI PIN-based Auth — client-side session management
import { LS_PIN_HASH, LS_SESSION } from './config';

// Simple hash (SHA-256) of the PIN — never sent over the network
async function hashPin(pin: string): Promise<string> {
  const buf = new TextEncoder().encode(`moe-ai:${pin}`);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Session = simple timestamp-based token stored in localStorage
interface Session {
  token: string;
  expiresAt: number; // ms since epoch
}
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export function isSessionValid(): boolean {
  try {
    const raw = localStorage.getItem(LS_SESSION);
    if (!raw) return false;
    const session: Session = JSON.parse(raw);
    return session.expiresAt > Date.now();
  } catch {
    return false;
  }
}

export function createSession(): void {
  const session: Session = {
    token: crypto.randomUUID(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  localStorage.setItem(LS_SESSION, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(LS_SESSION);
}

export function hasPinSet(): boolean {
  return !!localStorage.getItem(LS_PIN_HASH);
}

export async function setPin(pin: string): Promise<void> {
  const hash = await hashPin(pin);
  localStorage.setItem(LS_PIN_HASH, hash);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = localStorage.getItem(LS_PIN_HASH);
  if (!stored) return false;
  const hash = await hashPin(pin);
  return hash === stored;
}

export async function removePin(): Promise<void> {
  localStorage.removeItem(LS_PIN_HASH);
  clearSession();
}
