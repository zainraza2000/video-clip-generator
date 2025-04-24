import { AssemblyAI, TranscribeParams, Transcript, TranscriptUtterance } from 'assemblyai';
import { logger } from '../utils/logger';
import { ASSEMBLY_AI_API_KEY } from '../config';
import { TranscriptInternal } from '../types';

export function getTranscriptsByInterval(
  transcript: Transcript,
  interval: number,
): TranscriptInternal[] {
  const allUtterances = transcript.utterances;
  const transcriptsInternal: TranscriptInternal[] = []
  for (let i = 0; i < transcript.audio_duration!; i += interval) {
    const intervalUtterances = (allUtterances || []).filter(
      (utterance) => (utterance.start >= (i * 1000)) && (utterance.start < ((i + interval) * 1000))
    );
    transcriptsInternal.push({
      start: i,
      end: i + interval,
      utterances: intervalUtterances,
    });
  }
  return transcriptsInternal;
}

export async function generateTranscript(audioFilePath: string, speakersExpected?: number): Promise<Transcript> {
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to generate transcript', { error: errorMessage });
    throw new Error(`Failed to generate transcript: ${errorMessage}`);
  }
}