// Types and interfaces for the application\

import { Transcript } from 'assemblyai';

export interface VideoProcessRequest {
  videoUrl: string;
  requestId?: string;
  speakersExpected?: number;
}

export interface VideoProcessResponse {
  status: 'success' | 'error';
  message?: string;
  data?: {
    videoPath?: string;
    audioPath?: string;
    transcript?: Transcript;
    screenshot?: string;
  };
}

export interface S3Config {
  region: string;
  bucket?: string;
}

export interface UploadResponse {
  upload_url: string;
}

export interface TranscriptRequest {
  audio_url: string;
  speaker_labels: boolean;
  speakers_expected?: number;
}

// Using the official AssemblyAI SDK types
export type TranscriptResponse = Transcript;

export interface Utterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export interface Word {
  text: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: string;
}

export interface Speech {
  speaker: string;
  sentence: string;
}
export interface Transcription {
  speech: Speech;
  startTime: number;
  endTime: number;
}

export interface VideoInstance {
  transcription: Transcription;
  screenshot: string;
}