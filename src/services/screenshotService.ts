import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { randomInt } from 'crypto';
import { TMP_DIR } from '../config';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export async function extractRandomScreenshot(
  videoPath: string,
  startTimeMs: number,
  endTimeMs: number
): Promise<string> {
  const filename = `screenshot_${Date.now()}.png`;
  const screenshotPath = path.join(TMP_DIR, filename);
  const randomTimeSec = randomInt(startTimeMs, endTimeMs) / 1000;

  console.log(`screenshot Will extract at ${randomTimeSec}s`);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: [randomTimeSec],
        filename: path.basename(screenshotPath),
        folder: path.dirname(screenshotPath),
        size: '640x?'
      })
      .on('end', () => {
        console.log('[screenshot] Screenshot extraction completed');
        try {
          if (fs.existsSync(screenshotPath)) {
            resolve(screenshotPath);
          } else {
            reject(new Error('Screenshot not found at expected location.'));
          }
        } catch (err) {
          console.error('[screenshot] Error reading file:', err);
          reject(err);
        }
      })
      .on('error', (err) => {
        console.error('[screenshot] FFmpeg failed:', err.message);
        reject(err);
      });
  });
}
