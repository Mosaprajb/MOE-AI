import type { Env } from './types';

export interface MobileEnv extends Env {
  MOE_MOBILE_CONTROL_PIN?: string;
  MOE_MOBILE_SESSION_SECRET?: string;
  MOE_MOBILE_SESSION_TTL_SECONDS?: string;
  MOE_MOBILE_LIVE_CONTROL_ENABLED?: string;
  APNS_ENABLED?: string;
  APNS_TEAM_ID?: string;
  APNS_KEY_ID?: string;
  APNS_PRIVATE_KEY_P8?: string;
  APNS_BUNDLE_ID?: string;
}
