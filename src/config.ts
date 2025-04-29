// Configuration settings for the application
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// AssemblyAI API key
export const ASSEMBLY_AI_API_KEY = process.env.ASSEMBLY_AI_API_KEY || '';

// Temporary file storage path
export const TMP_DIR = process.env.TMP_DIR || './tmp';

// AWS credentials
export const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME!;
export const AWS_REGION = process.env.AWS_REGION!;
export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID!;
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY!;
export const AWS_SQS_QUEUE_URL = process.env.AWS_SQS_QUEUE_URL!

// LLM
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

// Default audio format for extraction
export const AUDIO_FORMAT = {
  codec: 'libmp3lame',
  quality: '2',
  extension: '.mp3'
};

// Validations
if (!ASSEMBLY_AI_API_KEY) {
  console.warn('WARNING: ASSEMBLY_AI_API_KEY is not set in .env file');
}

export const LOG_LEVEL = process.env.LOG_LEVEL;

export const TRANSCRIPTION_SEGMENT_INTERVAL = 5;
export const SCREENSHOTS_PER_SEGMENT = 2;
