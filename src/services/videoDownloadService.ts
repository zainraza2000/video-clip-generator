
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { TMP_DIR } from '../config';
import { logger } from '../utils/logger';


export async function downloadVideo(videoUrl: string): Promise<string> {
  try {
    logger.info('Starting video download', { videoUrl });
    
    if (!fs.existsSync(TMP_DIR)) {
      logger.info(`Creating temporary directory: ${TMP_DIR}`);
      fs.mkdirSync(TMP_DIR, { recursive: true });
    }
    
    const filename = `video-${Date.now()}.mp4`;
    const localPath = path.join(TMP_DIR, filename);
    
    logger.info('Downloading to local path', { localPath });
    
    
    return await downloadFile(videoUrl, localPath);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to download video', { error: errorMessage });
    throw new Error(`Failed to download video: ${errorMessage}`);
  }
}

async function downloadFile(url: string, localPath: string, redirectCount = 0): Promise<string> {
  if (redirectCount > 5) {
    throw new Error('Too many redirects');
  }
  
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const request = protocol.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        logger.info(`Following redirect to: ${response.headers.location}`);
        downloadFile(response.headers.location, localPath, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      if (!response.statusCode || response.statusCode !== 200) {
        reject(new Error(`Failed to download file: HTTP ${response.statusCode}`));
        return;
      }
      
      const file = fs.createWriteStream(localPath);
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        logger.info('File successfully downloaded', { localPath });
        resolve(localPath);
      });
      
      file.on('error', (err) => {
        fs.unlink(localPath, () => {});
        logger.error('Error writing file', { error: err.message });
        reject(err);
      });
    });
    
    request.on('error', (err) => {
      fs.unlink(localPath, () => {});
      logger.error('Error downloading file', { error: err.message });
      reject(err);
    });
  });
}