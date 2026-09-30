/**
 * Web Speech API feature detection for voice-to-text notes.
 *
 * The API is non-standard and vendor-prefixed. It is reliably present only in
 * Chromium-based browsers (Chrome, Edge); Firefox and many mobile browsers do
 * not implement it, so callers must HIDE the mic control there rather than
 * render a broken button.
 *
 * No API key and no server call are involved — but note that in several
 * Chromium builds the raw audio is still sent to the browser vendor's speech
 * service for transcription, and the UI says so rather than claiming the
 * feature is fully offline.
 *
 * @returns {typeof window.SpeechRecognition | typeof window.webkitSpeechRecognition | null}
 */
export function getSpeechRecognition() {
  if (typeof window === "undefined") return null;

  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/** True when this browser can transcribe speech via the built-in API. */
export function isSpeechRecognitionSupported() {
  return getSpeechRecognition() !== null;
}
