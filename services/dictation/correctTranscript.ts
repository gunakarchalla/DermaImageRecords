// Local post-correction for dictated consultation remarks.
//
// Contextual biasing gets the recognizer most of the way there, but it still
// mangles a long tail of clinical terms -- and it mangles them into ordinary
// English ("lesion" -> "legion"), which no recognizer setting can fix. This runs
// over the *final* transcript only (never interim, which would make the text
// jitter while the user is still speaking) and nudges near-misses back to the
// nearest term in our lexicon.
//
// The overriding constraint is do-no-harm: these are medical records, and a
// wrong "correction" is worse than an uncorrected word the clinician can see and
// fix. So every rule below is deliberately conservative -- high similarity
// thresholds, a minimum word length, and a stoplist of common English words we
// refuse to touch. When in doubt, we leave the transcript alone.

import { CORRECTION_LEXICON, HOMOPHONE_CORRECTIONS } from "./lexicon";

/**
 * Everyday words that sit close enough to a clinical term to be at risk of a
 * bogus rewrite. We never correct these, whatever the similarity score says.
 */
const PROTECTED_WORDS = new Set([
  "about", "above", "after", "again", "against", "along", "already", "also",
  "always", "another", "around", "aware", "because", "become", "been", "before",
  "being", "below", "better", "between", "both", "bring", "called", "came",
  "cannot", "change", "check", "clear", "close", "come", "coming", "could",
  "current", "days", "does", "doing", "done", "down", "during", "each", "early",
  "every", "field", "find", "first", "follow", "from", "gave", "give", "given",
  "goes", "going", "good", "great", "half", "hand", "have", "having", "here",
  "high", "history", "hold", "home", "hours", "into", "just", "keep", "kind",
  "know", "large", "last", "later", "least", "left", "less", "level", "like",
  "little", "long", "look", "made", "make", "many", "mild", "months", "more",
  "most", "much", "must", "need", "never", "next", "night", "none", "note",
  "noted", "notes", "nothing", "over", "part", "past", "patient", "people",
  "place", "plan", "please", "point", "possible", "present", "quite",
  "rather", "really", "recent", "report", "right", "said", "same", "seen",
  "sent", "several", "shall", "should", "show", "shown", "shows", "side",
  "significant", "similar", "since", "some", "start", "started", "still",
  "stop", "such", "sure", "take", "taken", "taking", "than", "that", "their",
  "them", "then", "there", "these", "they", "thing", "think", "this", "those",
  "three", "through", "time", "times", "today", "told", "took", "under",
  "until", "used", "using", "very", "want", "week", "weeks", "well", "were",
  "what", "when", "where", "which", "while", "will", "with", "within",
  "without", "work", "would", "year", "years", "your",
]);

/** Minimum word length before a single word is eligible for fuzzy repair. */
const MIN_FUZZY_LENGTH = 5;

/**
 * Similarity a candidate must clear to win, by phrase length in words. Multi-word
 * phrases carry far more signal than a lone word, so they can sit lower without
 * getting reckless.
 */
const SIMILARITY_THRESHOLD: Record<number, number> = {
  1: 0.86,
  2: 0.82,
  3: 0.8,
};

/** Longest phrase we attempt to match, in words. */
const MAX_PHRASE_WORDS = 3;

const normalise = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

/** Lexicon bucketed by word count, so we only compare like with like. */
const lexiconByWordCount = ((): Map<number, { normalised: string; original: string }[]> => {
  const buckets = new Map<number, { normalised: string; original: string }[]>();

  for (const term of CORRECTION_LEXICON) {
    const normalised = normalise(term);
    if (!normalised) continue;

    const wordCount = normalised.split(" ").length;
    if (wordCount > MAX_PHRASE_WORDS) continue;

    const bucket = buckets.get(wordCount) ?? [];
    bucket.push({ normalised, original: term });
    buckets.set(wordCount, bucket);
  }

  return buckets;
})();

const exactLexiconTerms = new Set(
  CORRECTION_LEXICON.map(normalise).filter(Boolean),
);

const homophoneEntries = Object.entries(HOMOPHONE_CORRECTIONS)
  .map(([heard, corrected]) => ({
    heard: normalise(heard),
    corrected,
    words: normalise(heard).split(" ").length,
  }))
  .filter((entry) => entry.heard && entry.heard !== normalise(entry.corrected));

/** Levenshtein distance, abandoned early once it cannot beat `maxDistance`. */
const editDistance = (a: string, b: string, maxDistance: number): number => {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMinimum = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost,
      );
      rowMinimum = Math.min(rowMinimum, current[j]);
    }

    // Every remaining row can only grow, so once the best cell in this row is
    // already too far away we can stop.
    if (rowMinimum > maxDistance) return maxDistance + 1;

    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length];
};

const similarity = (a: string, b: string): number => {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;

  // Anything below the loosest threshold is not worth measuring precisely.
  const maxDistance = Math.ceil(longest * (1 - SIMILARITY_THRESHOLD[3]));
  const distance = editDistance(a, b, maxDistance);

  return 1 - distance / longest;
};

/** Best lexicon term for `phrase`, or null when nothing clears the bar. */
const bestMatch = (phrase: string, wordCount: number): string | null => {
  const candidates = lexiconByWordCount.get(wordCount);
  if (!candidates) return null;

  const threshold = SIMILARITY_THRESHOLD[wordCount];
  let best: { term: string; score: number } | null = null;

  for (const candidate of candidates) {
    const score = similarity(phrase, candidate.normalised);
    if (score >= threshold && (!best || score > best.score)) {
      best = { term: candidate.original, score };
    }
  }

  return best?.term ?? null;
};

/** Carry the original's capitalisation onto the replacement. */
const matchCase = (replacement: string, original: string): string => {
  const isCapitalised = /^[A-Z]/.test(original) && !/^[A-Z]+$/.test(original);
  if (!isCapitalised) return replacement;

  return replacement.charAt(0).toUpperCase() + replacement.slice(1);
};

type Token = {
  /** The word itself, punctuation stripped. */
  word: string;
  /** Trailing punctuation, so rebuilding the sentence preserves it. */
  suffix: string;
};

const tokenise = (text: string): Token[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      const match = raw.match(/^([^\w]*)([\w'-]*)([\s\S]*)$/);
      if (!match) return { word: raw, suffix: "" };

      const [, prefix, word, trailing] = match;
      return { word: prefix + word, suffix: trailing };
    });

const isEligible = (word: string): boolean => {
  const normalised = normalise(word);

  if (normalised.length < MIN_FUZZY_LENGTH) return false;
  if (PROTECTED_WORDS.has(normalised)) return false;
  // Already a term we recognise -- nothing to fix, and fuzzy matching could
  // only drag it somewhere worse.
  if (exactLexiconTerms.has(normalised)) return false;
  if (/\d/.test(normalised)) return false;

  return true;
};

/**
 * Repair clinical terms in a finalised dictation segment.
 *
 * Longer phrases are matched first: "tinea versicolor" heard as "tinier
 * versicolor" is only recoverable as a pair, because "tinier" on its own is a
 * perfectly ordinary word we would (correctly) refuse to touch.
 */
export const correctTranscript = (transcript: string): string => {
  if (!transcript.trim()) return transcript;

  const tokens = tokenise(transcript);
  const output: string[] = [];
  let index = 0;

  while (index < tokens.length) {
    let replaced = false;

    for (
      let phraseLength = Math.min(MAX_PHRASE_WORDS, tokens.length - index);
      phraseLength >= 1 && !replaced;
      phraseLength -= 1
    ) {
      const slice = tokens.slice(index, index + phraseLength);
      const phrase = normalise(slice.map((token) => token.word).join(" "));
      if (!phrase) continue;

      // Known mishearings win outright -- they exist precisely because the
      // fuzzy pass cannot catch them.
      const homophone = homophoneEntries.find(
        (entry) => entry.words === phraseLength && entry.heard === phrase,
      );

      const correction =
        homophone?.corrected ??
        // A multi-word phrase is worth attempting even when its individual words
        // look ordinary; a lone word has to earn it.
        ((phraseLength > 1 || isEligible(slice[0].word)) &&
        !exactLexiconTerms.has(phrase)
          ? bestMatch(phrase, phraseLength)
          : null);

      if (!correction) continue;

      const trailingSuffix = slice[slice.length - 1].suffix;
      output.push(matchCase(correction, slice[0].word) + trailingSuffix);
      index += phraseLength;
      replaced = true;
    }

    if (!replaced) {
      const token = tokens[index];
      output.push(token.word + token.suffix);
      index += 1;
    }
  }

  return output.join(" ");
};

/**
 * Append a finalised segment to whatever the clinician has already typed or
 * dictated, spacing and capitalising it so the note reads as continuous prose.
 */
export const appendTranscript = (existing: string, segment: string): string => {
  const corrected = correctTranscript(segment).trim();
  if (!corrected) return existing;

  const base = existing.trimEnd();
  if (!base) return corrected.charAt(0).toUpperCase() + corrected.slice(1);

  // Start a new sentence if the previous one was closed off.
  const startsNewSentence = /[.!?]$/.test(base);
  const spaced = startsNewSentence
    ? corrected.charAt(0).toUpperCase() + corrected.slice(1)
    : corrected;

  return `${base} ${spaced}`;
};
