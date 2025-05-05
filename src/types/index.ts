// Types and interfaces for the application\

import { Transcript } from "assemblyai";

export type VideoResultType = "portrait" | "landscape";

export type InputVideo = {
  url: string;
  description?: string;
  speakersExpected?: number;
};

export type VideoProcessMessage = {
  videos: InputVideo[];
  userPrompt?: string;
  resultType?: VideoResultType;
};

export type PipelineResponse<T> =
  | {
      status: "success";
      message?: string;
      data: T;
    }
  | {
      status: "error";
      message: string;
    };

export type DownloadVideoResponse = PipelineResponse<{
  videoPaths: string[];
}>;

export type VideoToAudioResponse = PipelineResponse<{ audioPaths: string[] }>;

export type AudioToTranscriptResponse = PipelineResponse<{
  transcripts: Transcript[];
}>;

export type ExtractScreenshotResponse = PipelineResponse<{
  screenshotPaths: string[][];
}>;

export type FinalClipResponse = PipelineResponse<{
  videoPath: string;
  audioPath: string;
}>;

export type FinalResponse = PipelineResponse<{
  resultUrl: string;
}>;

export type UtteranceInternal = {
  speaker: string;
  text: string;
  start: number;
  end: number;
};

export type TranscriptInternal = {
  start: number;
  end: number;
  utterances: UtteranceInternal[];
};

export type PromptSegment = {
  text: string;
  images: string[];
};

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

export interface Subtitle {
  id: string;
  startTime: string;
  startSeconds: number;
  endTime: string;
  endSeconds: number;
  text: string;
}

export interface CaptionOptions {
  fontFamily?: string;
  fontSize?: number;
  fontColor?: string;
  backgroundColor?: string;
  boxOpacity?: number;
  position?: "center" | "bottom" | "top";
  textStyle?: "bold" | "italic" | "normal";
  animation?: "fade" | "slide" | "pop" | "none";
}
