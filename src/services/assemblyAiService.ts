import { AssemblyAI, TranscribeParams } from 'assemblyai';
import { logger } from '../utils/logger';
import { ASSEMBLY_AI_API_KEY } from '../config';
import { TranscriptResponse } from '../types';


export async function generateTranscript(audioFilePath: string, speakersExpected?: number): Promise<TranscriptResponse> {
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