import { getKillSwitch, getTradingMode } from './risk';
import type { TradingMode } from './types';
import {
  getStaticLivePolicy,
  type LiveControlEnv,
  type LivePolicyBlocker,
  type StaticLivePolicy,
} from './live-policy';
import {
  LIVE_CONTROL_BUILD_ID,
  verifyLiveSession,
  type LiveSessionPayload,
} from './live-session';

export {
  LIVE_CONTROL_BUILD_ID,
  LIVE_SESSION_HEADER,
  createLiveSession,
  verifyLivePin,
  verifyLiveSession,
  verifyLiveSessionToken,
} from './live-session';

export interface LiveExecutionPolicy extends StaticLivePolicy {
  build: string;
  storedMode: TradingMode;
  currentMode: TradingMode;
  runtimeKillSwitch: boolean;
  executionAllowed: boolean;
  webhookExecutionAllowed: boolean;
}

export interface LiveAuthorization {
  ok: boolean;
  status: number;
  code?: string;
  error?: string;
  policy: LiveExecutionPolicy;
  session?: LiveSessionPayload;
}

function runtimeBlockers(
  staticBlockers: LivePolicyBlocker[],
  runtimeKillSwitch: boolean,
): LivePolicyBlocker[] {
  const blockers = [...staticBlockers];
  if (runtimeKillSwitch && !blockers.some(blocker => blocker.code === 'LIVE_RUNTIME_KILL_SWITCH')) {
    blockers.push({
      code: 'LIVE_RUNTIME_KILL_SWITCH',
      message: 'The runtime kill switch is active.',
    });
  }
  return blockers;
}

export async function getLiveExecutionPolicy(env: LiveControlEnv): Promise<LiveExecutionPolicy> {
  const staticPolicy = getStaticLivePolicy(env);
  const [storedMode, runtimeKillSwitch] = await Promise.all([
    getTradingMode(env),
    getKillSwitch(env),
  ]);
  const blockers = runtimeBlockers(staticPolicy.blockers, runtimeKillSwitch);
  const executionAllowed = staticPolicy.executionAllowedByConfig && !runtimeKillSwitch;
  const webhookExecutionAllowed = staticPolicy.webhookExecutionAllowedByConfig && !runtimeKillSwitch;
  return {
    ...staticPolicy,
    build: LIVE_CONTROL_BUILD_ID,
    blockers,
    storedMode,
    currentMode: storedMode === 'LIVE' && executionAllowed ? 'LIVE' : 'SANDBOX',
    runtimeKillSwitch,
    executionAllowed,
    webhookExecutionAllowed,
  };
}


export async function authorizeLiveControl(
  request: Request,
  env: LiveControlEnv,
): Promise<LiveAuthorization> {
  const policy = await getLiveExecutionPolicy(env);
  if (!policy.executionAllowedByConfig) {
    return {
      ok: false,
      status: 423,
      code: 'LIVE_CONTROL_BLOCKED',
      error: 'Live control is blocked by the static server policy.',
      policy,
    };
  }
  const verification = await verifyLiveSession(request, env);
  if (!verification.ok) {
    return {
      ok: false,
      status: 401,
      code: verification.code,
      error: 'A valid Live control session is required.',
      policy,
    };
  }
  return {
    ok: true,
    status: 200,
    policy,
    session: verification.payload,
  };
}

export async function authorizeLiveExecution(
  request: Request,
  env: LiveControlEnv,
): Promise<LiveAuthorization> {
  const policy = await getLiveExecutionPolicy(env);
  if (!policy.executionAllowed) {
    return {
      ok: false,
      status: 423,
      code: 'LIVE_EXECUTION_BLOCKED',
      error: 'Live execution is blocked by the server policy.',
      policy,
    };
  }
  const verification = await verifyLiveSession(request, env);
  if (!verification.ok) {
    return {
      ok: false,
      status: 401,
      code: verification.code,
      error: 'A valid Live control session is required.',
      policy,
    };
  }
  return {
    ok: true,
    status: 200,
    policy,
    session: verification.payload,
  };
}
