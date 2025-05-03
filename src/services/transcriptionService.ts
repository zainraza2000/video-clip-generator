import {
  AssemblyAI,
  TranscribeParams,
  Transcript,
  TranscriptUtterance,
  TranscriptWord,
} from "assemblyai";
import { logger } from "../utils/logger";
import { ASSEMBLY_AI_API_KEY } from "../config";
import { TranscriptInternal, UtteranceInternal } from "../types";

export function getWordsByTime(
  transcript: Transcript,
  start: number,
  end: number,
  startIndex: number = 0
): TranscriptWord[] {
  const allWords = transcript.words || [];
  const wordsByTime = [];
  let i = startIndex;
  for (i = startIndex; i < allWords.length; i++) {
    if (allWords[i].start > end) break;
    if (allWords[i].start >= start) wordsByTime.push(allWords[i]);
  }
  return wordsByTime;
}

export function wordsToUtterances(
  words: TranscriptWord[]
): UtteranceInternal[] {
  let speaker = words[0].speaker || "A";
  let start = -1;
  let end = -1;
  const utterances: UtteranceInternal[] = [];
  let text = "";
  words.forEach((word) => {
    if (word.speaker !== speaker) {
      utterances.push({ start, end, text, speaker });
      speaker = word.speaker || "A";
      text = "";
      start = -1;
      end = -1;
    }
    if (start < 0) start = word.start;
    text += ` ${word.text}`;
    end = word.end;
  });
  if (text.length > 0) utterances.push({ start, end, text, speaker });
  return utterances;
}

export function getTranscriptsByInterval(
  transcript: Transcript,
  interval: number
): TranscriptInternal[] {
  const duration = transcript.audio_duration! * 1000
  const transcriptsInternal: TranscriptInternal[] = [];
  for (let i = 0; i < duration; i += interval) {
    const words = getWordsByTime(transcript, i, i + interval);
    const utterances = words.length > 0 ? wordsToUtterances(words) : [];
    transcriptsInternal.push({ start: i, end: i + interval, utterances });
  }
  return transcriptsInternal;
}

export async function getSubtitles(transcriptId: string) {
  try {
    const client = new AssemblyAI({
      apiKey: ASSEMBLY_AI_API_KEY,
    });

    const subtitles = await client.transcripts.subtitles(transcriptId);

    return subtitles;
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to generate subtitles", { error: errorMessage });
    throw new Error(`Failed to generate subtitles: ${errorMessage}`);
  }
}

export async function generateTranscript(
  audioFilePath: string,
  speakersExpected?: number
): Promise<Transcript> {
  try {
    const client = new AssemblyAI({
      apiKey: ASSEMBLY_AI_API_KEY,
    });
    const data: TranscribeParams = {
      audio: audioFilePath,
      speaker_labels: true,
      ...(speakersExpected && {
        speakers_expected: speakersExpected,
      }),
    };

    const transcript = await client.transcripts.transcribe(data);

    return transcript;
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to generate transcript", { error: errorMessage });
    throw new Error(`Failed to generate transcript: ${errorMessage}`);
  }
}
