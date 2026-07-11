import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useCallback, useEffect, useRef, useState } from "react";

import { BIASING_TERMS } from "../services/dictation/lexicon";

/**
 * Speech-to-text for clinical note fields.
 *
 * Recognition runs against the platform recognizer (Android SpeechRecognizer /
 * iOS SFSpeechRecognizer). Both are free and need no API key, so the accuracy
 * ceiling comes from how well we prime them, not from what we're willing to pay
 * for: we hand the recognizer our dermatology lexicon as contextual biasing
 * hints (`BIASING_TERMS`) every time a session starts.
 *
 * We default to the *network* recognizer because it is markedly better on rare
 * clinical vocabulary, and fall back to the on-device model when the network
 * one is unreachable -- so dictation still works in a clinic with no signal,
 * just less accurately.
 */

/** Indian English: closest match for the accent and drug brand names in use. */
const LANGUAGE = "en-IN";

/**
 * Dictating a note means thinking mid-sentence. The platform defaults end the
 * session after a beat of silence, which is wrong here -- the clinician stops
 * when they tap stop, not when they pause to look at the patient.
 */
const ANDROID_SILENCE_TIMEOUTS = {
  EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 10_000,
  EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 10_000,
  EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 60_000,
} as const;

export type DictationStatus = "idle" | "starting" | "listening";

type UseDictationOptions = {
  /** Called with each finalised chunk of speech, in the order it was spoken. */
  onSegment: (segment: string) => void;
};

export type Dictation = {
  status: DictationStatus;
  /** Speech recognised so far in the current utterance, not yet finalised. */
  interim: string;
  /** Set when a session fails; cleared when the next one starts. */
  error: string | null;
  isListening: boolean;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => void;
};

const startSession = (onDevice: boolean) =>
  ExpoSpeechRecognitionModule.start({
    lang: LANGUAGE,
    interimResults: true,
    continuous: true,
    addsPunctuation: true,
    requiresOnDeviceRecognition: onDevice,
    contextualStrings: [...BIASING_TERMS],
    iosTaskHint: "dictation",
    androidIntentOptions: ANDROID_SILENCE_TIMEOUTS,
  });

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone permission is needed to dictate.",
  "service-not-allowed": "Speech recognition is unavailable on this device.",
  "language-not-supported": "Speech recognition is unavailable for English (India).",
  "audio-capture": "Could not access the microphone.",
  busy: "The recogniser is busy. Try again in a moment.",
  "no-speech": "Didn't catch that. Try again.",
  "speech-timeout": "Didn't catch that. Try again.",
};

export const useDictation = ({ onSegment }: UseDictationOptions): Dictation => {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The consumer re-renders on every keystroke, so read the callback through a
  // ref -- otherwise each render would tear down and rebuild the listeners.
  const onSegmentRef = useRef(onSegment);
  onSegmentRef.current = onSegment;

  // Whether the *current* session already fell back to on-device, so a second
  // network error can't put us in a retry loop.
  const usingOnDeviceRef = useRef(false);

  useSpeechRecognitionEvent("start", () => {
    setStatus("listening");
  });

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript ?? "";
    if (!transcript.trim()) return;

    if (event.isFinal) {
      setInterim("");
      onSegmentRef.current(transcript);
    } else {
      setInterim(transcript);
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    // The network recogniser is unreachable -- retry this session on-device
    // rather than failing in front of the user.
    if (event.error === "network" && !usingOnDeviceRef.current) {
      usingOnDeviceRef.current = true;
      setInterim("");
      startSession(true);
      return;
    }

    setInterim("");
    setStatus("idle");
    setError(
      ERROR_MESSAGES[event.error] ??
        event.message ??
        "Dictation failed. Please try again.",
    );
  });

  useSpeechRecognitionEvent("end", () => {
    setInterim("");
    setStatus("idle");
  });

  // Leaving the screen mid-sentence must not leave the microphone hot.
  useEffect(() => {
    return () => {
      ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setInterim("");
    setStatus("starting");

    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setStatus("idle");
      setError(
        permission.canAskAgain
          ? "Microphone permission is needed to dictate."
          : "Enable microphone access for this app in Settings to dictate.",
      );
      return;
    }

    try {
      usingOnDeviceRef.current = false;
      startSession(false);
    } catch {
      setStatus("idle");
      setError("Could not start dictation. Please try again.");
    }
  }, []);

  const isListening = status === "listening" || status === "starting";

  const toggle = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      void start();
    }
  }, [isListening, start, stop]);

  return { status, interim, error, isListening, start, stop, toggle };
};
