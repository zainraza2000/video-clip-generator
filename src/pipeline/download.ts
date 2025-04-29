import { DownloadVideoResponse, InputVideo } from "../types/index";
import { logger } from "../utils/logger";
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
