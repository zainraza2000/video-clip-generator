import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import logger from '../utils/logger';
import { FinalClipResponse } from '../types';
import { Transcript } from 'assemblyai';
import { Clips } from '../schemas/clips';

// Promisified versions of fs functions
const mkdirPromise = util.promisify(fs.mkdir);
const unlinkPromise = util.promisify(fs.unlink);
const existsPromise = util.promisify(fs.exists);

export function filterClips(transcripts: Transcript[], clips: Clips){
  const filteredClips = clips
    .filter(
      (clip) => transcripts[clip.index]?.audio_duration && clip.start >= 0
    )
    .map((clip) => {
      const audio_duration = transcripts[clip.index].audio_duration;
      let end = clip.end;
      if (end > audio_duration! * 1000) {
        end = audio_duration! * 1000;
      }
      return { ...clip, end };
    });

  return filteredClips;
}

// Helper function to get video info
const getVideoInfo = (videoPath: string): Promise<{ width: number; height: number; frameRate: string; sampleRate: number }> => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        logger.error(`Failed to probe video ${videoPath}: ${err}`, { service: 'clip-service' });
        // Return default values if probing fails
        resolve({
          width: 1280, 
          height: 720, 
          frameRate: '30/1',
          sampleRate: 44100
        });
        return;
      }

      try {
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
        
        const width = videoStream?.width || 1280;
        const height = videoStream?.height || 720;
        const frameRate = videoStream?.r_frame_rate || '30/1';
        const sampleRate = audioStream?.sample_rate || 44100;
        
        resolve({ width, height, frameRate, sampleRate });
      } catch (error) {
        logger.error(`Error parsing video metadata: ${error}`, { service: 'clip-service' });
        resolve({
          width: 1280, 
          height: 720, 
          frameRate: '30/1',
          sampleRate: 44100
        });
      }
    });
  });
};


// Helper function to create a clip
const createClip = async (
  sourceVideo: string,
  outputPath: string,
  startTime: number,
  duration: number,
  videoInfo: { width: number; height: number; frameRate: string; sampleRate: number }
): Promise<boolean> => {
  return new Promise((resolve) => {
    try {
      ffmpeg(sourceVideo)
        .setStartTime(startTime)
        .setDuration(duration)
        .outputOptions([
          `-vf scale=${videoInfo.width}:${videoInfo.height},fps=${videoInfo.frameRate}`,
          '-c:v libx264',
          '-preset fast',
          '-crf 18',
          '-c:a aac',
          '-b:a 192k',
          `-ar ${videoInfo.sampleRate}`,
          '-async 1'
        ])
        .on('error', (err) => {
          logger.error(`Error creating clip segment: ${err}`, { service: 'clip-service' });
          resolve(false);
        })
        .on('end', () => {
          resolve(true);
        })
        .save(outputPath);
    } catch (err) {
      logger.error(`Exception in createClip: ${err}`, { service: 'clip-service' });
      resolve(false);
    }
  });
};

// Helper function to concatenate clips
const concatenateClips = async (
  clipPaths: string[],
  outputVideoPath: string,
  outputAudioPath: string
): Promise<boolean> => {
  return new Promise((resolve) => {
    try {
      // Check if we have clips to concatenate
      if (clipPaths.length === 0) {
        logger.error('No clip paths provided for concatenation', { service: 'clip-service' });
        resolve(false);
        return;
      }

      // If we only have one clip, just copy it as the final output
      if (clipPaths.length === 1) {
        const command = ffmpeg(clipPaths[0]);
        
        // Create a command that splits the audio to two outputs
        command
          .output(outputVideoPath)
          .outputOptions([
            '-c:v copy',
            '-c:a aac',
            '-b:a 192k'
          ])
          .on('error', (err) => {
            logger.error(`Error copying video: ${err}`, { service: 'clip-service' });
            resolve(false);
          });
          
        command
          .output(outputAudioPath)
          .outputOptions([
            '-vn',
            '-c:a libmp3lame',
            '-q:a 2'
          ])
          .on('error', (err) => {
            logger.error(`Error extracting audio: ${err}`, { service: 'clip-service' });
            // Continue even if audio extraction fails
          });
          
        command
          .on('end', () => {
            resolve(true);
          })
          .run();
          
        return;
      }

      // Using the concat filter method - create a script file for concatenation
      const listFilePath = path.join(process.cwd(), 'tmp', 'concat_list.txt');
      let fileContent = '';
      clipPaths.forEach(clip => {
        fileContent += `file '${clip}'\n`;
      });
      
      // Write the list file
      try {
        fs.writeFileSync(listFilePath, fileContent);
      } catch (err) {
        logger.error(`Error writing concat list file: ${err}`, { service: 'clip-service' });
        // Fallback to first clip if list file creation fails
        if (clipPaths.length > 0) {
          fs.copyFileSync(clipPaths[0], outputVideoPath);
          logger.info(`Fallback to first clip due to list file error`, { service: 'clip-service' });
          resolve(true);
        } else {
          resolve(false);
        }
        return;
      }
      
      // First create the video output
      const videoCommand = ffmpeg()
        .input(listFilePath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions([
          '-c:v libx264',
          '-preset fast',
          '-crf 18',
          '-c:a aac',
          '-b:a 192k'
        ])
        .output(outputVideoPath)
        .on('error', (err) => {
          logger.error(`Error concatenating video: ${err}`, { service: 'clip-service' });
          // Fallback to first clip
          if (clipPaths.length > 0) {
            logger.info('Falling back to using the first clip as output', { service: 'clip-service' });
            try {
              fs.copyFileSync(clipPaths[0], outputVideoPath);
            } catch (copyErr) {
              logger.error(`Error copying fallback clip: ${copyErr}`, { service: 'clip-service' });
            }
          }
        })
        .on('end', () => {
          // After video is created, create the audio file separately
          ffmpeg(outputVideoPath)
            .output(outputAudioPath)
            .outputOptions([
              '-vn',
              '-c:a libmp3lame',
              '-q:a 2'
            ])
            .on('error', (err) => {
              logger.error(`Error creating audio output: ${err}`, { service: 'clip-service' });
              // Continue even if audio extraction fails
              resolve(true); // Still consider successful since video was created
            })
            .on('end', () => {
              // Clean up the list file
              try {
                fs.unlinkSync(listFilePath);
              } catch (unlinkErr) {
                logger.warn(`Failed to delete concat list file: ${unlinkErr}`, { service: 'clip-service' });
              }
              resolve(true);
            })
            .run();
        })
        .run();
    } catch (err) {
      logger.error(`Exception in concatenateClips: ${err}`, { service: 'clip-service' });
      
      // Fallback to first clip if there's any clip
      if (clipPaths.length > 0) {
        try {
          logger.info('Falling back to first clip due to exception', { service: 'clip-service' });
          fs.copyFileSync(clipPaths[0], outputVideoPath);
          
          // Create audio from the first clip
          ffmpeg(clipPaths[0])
            .output(outputAudioPath)
            .outputOptions([
              '-vn',
              '-c:a libmp3lame',
              '-q:a 2'
            ])
            .on('error', (err) => {
              logger.error(`Error extracting audio in fallback: ${err}`, { service: 'clip-service' });
              resolve(true); // Still consider successful since video was created
            })
            .on('end', () => {
              resolve(true);
            })
            .run();
        } catch (copyErr) {
          logger.error(`Error in fallback copying: ${copyErr}`, { service: 'clip-service' });
          resolve(false);
        }
      } else {
        resolve(false);
      }
    }
  });
};

/**
 * Generates a final clip from multiple video segments
 * @param videoPaths Array of paths to source videos
 * @param clips Array of clip definitions with start, end, order, and index properties
 * @returns FinalClipResponse with status and output paths
 */
export async function generateFinalClip(
  videoPaths: string[],
  clips: Clips
): Promise<FinalClipResponse> {
  // Create temp directory for storing clip segments
  const tempDir = path.join(process.cwd(), 'tmp');
  const clipPaths: string[] = [];
  console.log(clips)
  
  try {
    // Create temp directory if it doesn't exist
    await mkdirPromise(tempDir, { recursive: true })
      .catch(err => {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
          logger.warn(`Failed to create temp directory: ${err}`, { service: 'clip-service' });
        }
      });
    
    // Sort clips by their order property
    const orderedClips = [...clips].sort((a, b) => a.order - b.order);
    
    // If no clips provided, return error
    if (orderedClips.length === 0) {
      logger.error('No clips provided to generate final clip', { service: 'clip-service' });
      return { 
        status: 'error', 
        message: 'No clips provided',
      };
    }
    
    // If no video paths provided, return error
    if (videoPaths.length === 0) {
      logger.error('No video paths provided to generate clips from', { service: 'clip-service' });
      return { 
        status: 'error', 
        message: 'No video paths provided',
      };
    }
    
    // Get video info from the first available video to use as reference
    let referenceVideoPath = videoPaths[0];
    for (const path of videoPaths) {
      if (await existsPromise(path)) {
        referenceVideoPath = path;
        break;
      }
    }
    
    const videoInfo = await getVideoInfo(referenceVideoPath);
    
    // Process each clip
    let successfulClips = 0;
    for (let i = 0; i < orderedClips.length; i++) {
      try {
        const clip = orderedClips[i];
        const videoIndex = clip.index;
        
        // Skip if invalid video index
        if (videoIndex < 0 || videoIndex >= videoPaths.length) {
          logger.error(`Invalid video index ${videoIndex} for clip at order ${clip.order}`, { service: 'clip-service' });
          continue;
        }
        
        const sourceVideo = videoPaths[videoIndex];
        
        // Skip if video path doesn't exist
        if (!await existsPromise(sourceVideo)) {
          logger.error(`Video not found at path: ${sourceVideo}`, { service: 'clip-service' });
          continue;
        }
        
        const clipFilename = path.join(tempDir, `clip_${i}.mp4`);
        
        // Calculate duration in seconds
        const startSec = clip.start / 1000;
        const durationSec = (clip.end - clip.start) / 1000;
        
        // Skip if invalid duration
        if (durationSec <= 0) {
          logger.error(`Invalid clip duration for clip at order ${clip.order}: ${durationSec}s`, { service: 'clip-service' });
          continue;
        }
        
        logger.info(`Creating clip ${i+1}/${orderedClips.length} from ${sourceVideo}`, { service: 'clip-service' });
        
        // Create the clip
        const success = await createClip(sourceVideo, clipFilename, startSec, durationSec, videoInfo);
        
        if (success) {
          clipPaths.push(clipFilename);
          successfulClips++;
        }
      } catch (error) {
        logger.error(`Error processing clip ${i}: ${error}`, { service: 'clip-service' });
      }
    }
    
    // Define output paths
    const outputVideoPath = path.join(process.cwd(), 'final_clip.mp4');
    const outputAudioPath = path.join(process.cwd(), 'final_clip.mp3');
    
    // If no clips were successfully created, return error
    if (successfulClips === 0) {
      logger.error('Failed to create any clips', { service: 'clip-service' });
      return { 
        status: 'error', 
        message: 'Failed to create any clips',
      };
    }
    
    // Concatenate the clips
    logger.info(`Concatenating ${clipPaths.length} clips into final video and audio`, { service: 'clip-service' });
    const concatSuccess = await concatenateClips(clipPaths, outputVideoPath, outputAudioPath);
    
    if (concatSuccess) {
      logger.info(`Final clip generated: ${outputVideoPath}`, { service: 'clip-service' });
      logger.info(`Final audio generated: ${outputAudioPath}`, { service: 'clip-service' });
      
      return {
        status: 'success',
        data: {
          videoPath: outputVideoPath,
          audioPath: outputAudioPath,
        },
      };
    } else {
      // If concatenation failed but we have at least one clip, use that as fallback
      if (clipPaths.length > 0) {
        logger.warn('Concatenation failed, using first clip as fallback', { service: 'clip-service' });
        
        try {
          // Copy the first clip as the final output
          fs.copyFileSync(clipPaths[0], outputVideoPath);
          
          // Create audio from the first clip
          await new Promise<void>((resolve) => {
            ffmpeg(clipPaths[0])
              .output(outputAudioPath)
              .outputOptions([
                '-vn',
                '-c:a libmp3lame',
                '-q:a 2'
              ])
              .on('error', (err) => {
                logger.error(`Error extracting audio from fallback clip: ${err}`, { service: 'clip-service' });
                resolve();
              })
              .on('end', () => {
                resolve();
              })
              .run();
          });
          
          logger.info(`Fallback clip used as final output: ${outputVideoPath}`, { service: 'clip-service' });
          
          return {
            status: 'success',
            data: {
              videoPath: outputVideoPath,
              audioPath: outputAudioPath,
            },
          };
        } catch (err) {
          logger.error(`Error using fallback clip: ${err}`, { service: 'clip-service' });
        }
      }
      
      return { 
        status: 'error', 
        message: 'Failed to concatenate clips',
      };
    }
  } catch (error) {
    logger.error(`Error generating final clip: ${error}`, { service: 'clip-service' });
    return { 
      status: 'error', 
      message: JSON.stringify(error),
    };
  } finally {
    // Clean up temporary files
    try {
      for (const clipPath of clipPaths) {
        if (await existsPromise(clipPath)) {
          await unlinkPromise(clipPath).catch(err => {
            logger.warn(`Failed to delete temp file ${clipPath}: ${err}`, { service: 'clip-service' });
          });
        }
      }
    } catch (cleanupError) {
      logger.warn(`Error during cleanup: ${JSON.stringify(cleanupError)}`, { service: 'clip-service' });
    }
  }
}
