import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { Icon } from "./Icons";

/**
 * Voice-to-text control for a free-text note field.
 *
 * A microphone that dictates into the field the caller owns: `onTranscript`
 * receives each finalized chunk and the caller appends it. The button only
 * ever edits text — it never submits, so the technician always reviews what
 * was transcribed before saving.
 *
 * Hidden entirely when the browser has no Web Speech API (Firefox, many
 * mobile browsers). Showing a control that cannot work would be worse than
 * showing none.
 *
 * The disclaimer is deliberate and accurate: there is no API key and no call
 * to our own server, but in several Chromium builds the audio is still sent
 * to the browser vendor's speech service, so the copy does not claim this is
 * fully offline.
 *
 * @param {object} props
 * @param {(text: string) => void} props.onTranscript
 * @param {string} [props.label]
 * @param {boolean} [props.disabled]
 * @param {string} [props.hintId] id of the description element, for a11y
 */
export function VoiceInputButton({
  onTranscript,
  label = "Dictate note",
  disabled = false,
  hintId,
}) {
  const { supported, listening, interim, error, start, stop } = useSpeechRecognition({
    onTranscript,
  });

  if (!supported) return null;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={listening ? stop : start}
          disabled={disabled}
          aria-pressed={listening}
          aria-describedby={hintId}
          title="Voice input uses your browser's built-in speech recognition."
          className={`inline-flex items-center gap-1.5 rounded-pill border px-3.5 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
            listening
              ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              : "border-slate-200 text-slate-700 hover:border-brand-300 hover:bg-brand-50"
          }`}
        >
          <Icon name={listening ? "stop" : "mic"} className="h-4 w-4" />
          {listening ? "Stop dictation" : label}
        </button>

        {listening && (
          <span role="status" className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
            Listening…
            {interim && <span className="max-w-[16rem] truncate text-slate-500">“{interim}”</span>}
          </span>
        )}
      </div>

      <p id={hintId} className="mt-1.5 text-[11px] text-slate-500">
        Voice input uses your browser's built-in speech recognition — your
        browser may send the audio to its speech service. Transcription is not
        perfect: review and edit before saving.
      </p>

      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
