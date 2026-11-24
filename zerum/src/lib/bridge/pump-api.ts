/** A `PumpApi` sobre a API HTTP do próprio app (lib/client.ts — o único lugar do código que usa `fetch`). */
import { apiGet, apiGetBytes, apiPost, apiPutBytes } from '../client';
import type { SettingsDTO } from '../types';
import type { PumpApi } from './pump';
import type { ClaimResponse, ClipResponse, FailResponse, HeartbeatResponse, ProgressResponse } from './work';

const scene = (w: { videoId: string; sceneIdx: number }, tail: string) => `/bridge/scenes/${encodeURIComponent(w.videoId)}/${w.sceneIdx}/${tail}`;

export const httpPumpApi: PumpApi = {
  heartbeat: (body) => apiPost<HeartbeatResponse>('/bridge/heartbeat', body),
  claim: (body) => apiPost<ClaimResponse>('/bridge/claim', body),
  progress: (w, pumpId, orderId) => apiPost<ProgressResponse>(scene(w, 'progress'), { pumpId, orderId }),
  uploadClip: (w, pumpId, orderId, mediaRef, bytes) => apiPutBytes<ClipResponse>(`${scene(w, 'clip')}?pumpId=${encodeURIComponent(pumpId)}&orderId=${encodeURIComponent(orderId)}&mediaRef=${encodeURIComponent(mediaRef)}`, bytes),
  fail: (w, body) => apiPost<FailResponse>(scene(w, 'fail'), body),
  settings: async () => {
    const s = await apiGet<SettingsDTO>('/settings');
    return { parallel: s.parallel, autoSwitch: s.autoSwitch, minCredits: s.minCredits };
  },
  photo: (avatarId) => apiGetBytes(`/avatars/${encodeURIComponent(avatarId)}/photo`),
};
