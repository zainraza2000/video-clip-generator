// Configuration settings for the application
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// AssemblyAI API key
export const ASSEMBLY_AI_API_KEY = process.env.ASSEMBLY_AI_API_KEY || '';

// Temporary file storage path
export const TMP_DIR = process.env.TMP_DIR || './tmp';

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