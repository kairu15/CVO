import { useCallback, useEffect, useRef, useState } from "react";
import { getSpeechRecognition } from "../lib/speechRecognition";

/**
 * Browser speech-to-text, wired to a plain callback.
 *
 * Uses the built-in Web Speech API: no server call, no API key. The hook only
 * transcribes — it never submits anything, so a technician can stop, review
 * and edit the text before saving.
 *
 * Handles the API's real-world constraints:
 *  - feature-detected once (unsupported browsers just get `supported: false`,
 *    and the control is hidden);
 *  - some browsers end the session after a short pause, so while the user
 *    still has dictation on we transparently restart it;
 *  - permission and capture failures are surfaced as `error`, never swallowed.
 *
 * @param {object} options
 * @param {(text: string) => void} options.onTranscript called with each
 *   finalized chunk — the caller appends it to their field
 * @param {string} [options.lang] BCP-47 language; defaults to the browser locale
 */
export function useSpeechRecognition({ onTranscript, lang } = {}) {
  const Recognition = getSpeechRecognition();
  const supported = Boolean(Recognition);

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);
  // Read the callback through a ref so the recognition handlers never capture
  // a stale closure, and so an inline arrow from the caller does not restart
  // the session.
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    setListening(false);
    setInterim("");

    try {
      recognitionRef.current?.stop?.();
    } catch {
      // A recognition instance that already ended can throw on stop — the
      // state is already reset above, so there is nothing to recover.
    }
  }, []);

  const start = useCallback(() => {
    if (!supported) {
      setError("Voice input isn't available in this browser. You can type instead.");
      return;
    }

    setError(null);

    const recognition = new Recognition();
    recognition.lang = lang || (typeof navigator !== "undefined" && navigator.language) || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let pending = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript ?? "";

        if (result.isFinal) {
          const final = text.trim();

          if (final) onTranscriptRef.current?.(final);
        } else {
          pending += text;
        }
      }

      setInterim(pending.trim());
    };

    recognition.onerror = (event) => {
      const code = event?.error;

      // `aborted`/`no-speech` are routine: the user stopped, or paused. They
      // are not failures and should not show an error banner.
      if (code === "no-speech" || code === "aborted") return;

      shouldListenRef.current = false;
      setListening(false);
      setInterim("");

      setError(
        code === "not-allowed" || code === "service-not-allowed"
          ? "Microphone access was blocked. Allow it in your browser and try again."
          : "Voice input stopped unexpectedly. You can type instead.",
      );
    };

    recognition.onend = () => {
      if (shouldListenRef.current) {
        // Some browsers close the session after a pause even with
        // `continuous = true`; restart while the technician still has it on.
        try {
          recognition.start();
          return;
        } catch {
          shouldListenRef.current = false;
        }
      }

      setListening(false);
      setInterim("");
    };

    recognitionRef.current = recognition;
    shouldListenRef.current = true;
    setListening(true);

    try {
      recognition.start();
    } catch {
      shouldListenRef.current = false;
      setListening(false);
      setError("Voice input could not start. You can type instead.");
    }
  }, [Recognition, supported, lang]);

  // Abort an in-flight session when the form unmounts (e.g. the modal closes)
  // so the microphone is not left on.
  useEffect(
    () => () => {
      shouldListenRef.current = false;

      try {
        recognitionRef.current?.abort?.();
      } catch {
        // Nothing to do: the component is going away anyway.
      }
    },
    [],
  );

  return {
    supported,
    listening,
    interim,
    error,
    start,
    stop,
    clearError: () => setError(null),
  };
}
