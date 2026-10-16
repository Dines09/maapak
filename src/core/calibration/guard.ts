// Scale-change guard (§3.7): measuring is disabled when the display scale no longer matches calibration.
import { makeDeviceKey, type ScreenEnv } from './deviceKey';
import type { CalibrationProfile } from './profile';

export type GuardReason = 'zoom' | 'dpr' | 'screen' | 'device';

export interface GuardResult {
  ok: boolean;
  reasons: GuardReason[];
}

export function checkScaleGuard(env: ScreenEnv, profile: CalibrationProfile | null): GuardResult {
  const reasons: GuardReason[] = [];
  if (Math.abs(env.visualScale - 1) > 0.001) reasons.push('zoom');
  if (profile && profile.method !== 'estimate') {
    const now = makeDeviceKey(env);
    const k = profile.deviceKey;
    if (Math.abs(now.dpr - k.dpr) > 0.001) reasons.push('dpr');
    if (now.screenW !== k.screenW || now.screenH !== k.screenH) reasons.push('screen');
    if ((now.model ?? '') !== (k.model ?? '') || now.browser !== k.browser) reasons.push('device');
  }
  return { ok: reasons.length === 0, reasons };
}
