/** Crypt Announcer voice clip manifest: ids, spoken lines and public URLs. */
export const ANNOUNCER_BASE_URL = '/assets/audio/announcer/';

export const VOICE_CLIPS = [
  { id: 'welcome', text: 'WELCOME TO MONSTER LEAGUE FOOTBALL!' },
  { id: 'touchdown', text: 'TOUCHDOWN!' },
  { id: 'its-good', text: "IT'S GOOD!" },
  { id: 'fumble', text: 'FUMBLE ON THE PLAY!' },
  { id: 'intercepted', text: 'INTERCEPTED!' },
  { id: 'nasty-audible', text: 'NASTY AUDIBLE!' },
  { id: 'player-liquidated', text: 'PLAYER LIQUIDATED!' },
  { id: 'ref-bribed', text: 'THE REF HAS BEEN BRIBED!' },
  { id: 'penalty-crying', text: 'PENALTY: FIVE YARDS FOR EXCESSIVE CRYING!' },
  { id: 'kill-the-ref', text: 'KILL THE REF!' },
  { id: 'ref-bashing', text: 'REF BASHING! FIVE YARD PENALTY!' },
  { id: 'forfeit', text: 'FORFEIT BY CARNAGE! GAME OVER!' },
] as const;

export type VoiceClipId = (typeof VOICE_CLIPS)[number]['id'];

export interface ResolvedVoiceClip {
  id: VoiceClipId;
  text: string;
  url: string;
}

export function isVoiceClipId(id: string): id is VoiceClipId {
  return VOICE_CLIPS.some((c) => c.id === id);
}

/** Resolve a clip id to its spoken text and mp3 URL. Throws on unknown ids. */
export function resolveVoiceClip(
  id: string,
  baseUrl: string = ANNOUNCER_BASE_URL,
): ResolvedVoiceClip {
  const clip = VOICE_CLIPS.find((c) => c.id === id);
  if (!clip) throw new Error(`Unknown voice clip: ${id}`);
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return { id: clip.id, text: clip.text, url: `${base}${clip.id}.mp3` };
}
