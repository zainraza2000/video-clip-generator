import { downloadVideo } from './services/VideoDownload';
import { extractAudio } from './services/audioExtractor';
import { generateTranscript } from './services/assemblyAiService';
import { extractRandomScreenshot } from './services/screenshotService';
import { VideoProcessResponse } from './types/index';
import { logger } from './utils/logger';
import path from 'path';

export async function processVideoRequest({ videoUrl }: { videoUrl: string }): Promise<VideoProcessResponse> {
  try {
    const mediaPath = await downloadVideo(videoUrl);
    const fileExt = path.extname(mediaPath).toLowerCase();

    let screenshotPath: string | undefined;
    try {
      screenshotPath = await extractRandomScreenshot(mediaPath, 69250, 69354);
    } catch (screenshotError) {
      logger.warn('Screenshot capture failed', { error: (screenshotError as Error).message });
    }

    let audioPath = mediaPath;
    if (!['.mp3', '.wav', '.aac', '.ogg', '.flac'].includes(fileExt)) {
      audioPath = await extractAudio(mediaPath);
    }

    const transcript = await generateTranscript(audioPath);

    return {
      status: 'success',
      data: {
        videoPath: mediaPath,
        audioPath,
        transcript,
        screenshot: screenshotPath
      }
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error processing video request', { error: errorMessage });

    return {
      status: 'error',
      message: errorMessage
    };
  }
}
