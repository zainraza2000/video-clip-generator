import { extractAudio } from "../services/audioExtractor";
import { VideoToAudioResponse } from "../types/index";
import { logger } from "../utils/logger";

export async function videosToAudios(
  videoPaths: string[]
): Promise<VideoToAudioResponse> {
  try {
    const audioPaths = await Promise.all(
      videoPaths.map((videoPath) => extractAudio(videoPath))
    );

    return {
      status: "success",
      data: {
        audioPaths,
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
