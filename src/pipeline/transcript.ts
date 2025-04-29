import { AudioToTranscriptResponse } from "../types/index";
import { logger } from "../utils/logger";
import { generateTranscript } from "../services/transcriptionService";

export async function audiosToTranscripts(
  audioPaths: string[]
): Promise<AudioToTranscriptResponse> {
  try {
    const transcripts = await Promise.all(
      audioPaths.map((audioPath) => generateTranscript(audioPath))
    );

    return {
      status: "success",
      data: {
        transcripts,
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
