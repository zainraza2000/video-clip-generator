// Service to extract audio from video files
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { AUDIO_FORMAT } from '../config';
import { logger } from '../utils/logger';


export async function extractAudio(videoPath: string): Promise<string> {
  const audioFilename = path.basename(videoPath, path.extname(videoPath)) + AUDIO_FORMAT.extension;
  const audioPath = path.join(path.dirname(videoPath), audioFilename);
  
  logger.info('Extracting audio from video', { videoPath, audioPath });
  
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,              
      '-vn',                
      '-acodec', AUDIO_FORMAT.codec,
      '-q:a', AUDIO_FORMAT.quality, 
      '-y',                         
      audioPath                     
    ]);
    
    // Handle process output
    let ffmpegLogs = '';
    
    ffmpeg.stdout.on('data', (data) => {
      ffmpegLogs += data.toString();
    });
    
    ffmpeg.stderr.on('data', (data) => {
      ffmpegLogs += data.toString();
    });
    
    // Handle process completion
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        logger.info('Audio extraction completed successfully', { audioPath });
        resolve(audioPath);
      } else {
        logger.error('FFmpeg process exited with error', { code, logs: ffmpegLogs });
        reject(new Error(`FFmpeg process exited with code ${code}: ${ffmpegLogs}`));
      }
    });
    
    ffmpeg.on('error', (err) => {
      logger.error('Failed to start FFmpeg process', { error: err });
      reject(new Error(`Failed to start FFmpeg process: ${err.message}`));
    });
  });
}


export async function checkFFmpegAvailability(): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ['-version']);
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('FFmpeg is not available. Please install FFmpeg to proceed.'));
      }
    });
    
    ffmpeg.on('error', () => {
      logger.error('FFmpeg not found');
      reject(new Error('FFmpeg is not installed or not in PATH'));
    });
  });
}