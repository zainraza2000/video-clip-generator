import { DownloadVideoResponse, InputVideo, VideoPathWithDuration } from "../types/index";
import { logger } from "../utils/logger";
import ffmpeg from 'fluent-ffmpeg';
import { downloadVideo } from "../services/videoDownloadService";

export async function downloadVideos(
  videos: InputVideo[]
): Promise<DownloadVideoResponse> {
  try {
    const videoPaths = await Promise.all(
      videos.map((video) => downloadVideo(video.url))
    );

    return {
      status: "success",
      data: {
        videoPaths,
      },
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("Error processing video request", { error: errorMessage });

    return {
      status: "error",
      message: errorMessage,
    };
  }
}

function getVideoDuration(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(path, (err, metadata) => {
      if (err) return reject(err);
      const duration = Math.floor((metadata.format.duration || 0 )* 10) / 10;
      if (typeof duration !== 'number') return reject(new Error('Invalid duration'));
      resolve(duration);
    });
  });
}

export async function getVideoDurations(
  paths: string[]
): Promise<VideoPathWithDuration[]> {
  const results: VideoPathWithDuration[] = [];

  for (const path of paths) {
    try {
      const duration = await getVideoDuration(path);
      results.push({ path, duration });
    } catch (error) {
      console.error(`Failed to get duration for ${path}:`, error);
    }
  }

  return results;
}