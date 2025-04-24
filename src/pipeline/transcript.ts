import { AudioToTranscriptResponse } from "../types/index";
import { logger } from "../utils/logger";
import fsP from "fs/promises";
import { generateTranscript } from "../services/transcription";

export async function audiosToTranscripts(
  audioPaths: string[]
): Promise<AudioToTranscriptResponse> {
  try {
    const transcripts = await Promise.all(
      audioPaths.map((audioPath) => generateTranscript(audioPath))
    );
    // const jsonString = await fsP.readFile("transcript.json", "utf8"); // to remove
    // const transcript = JSON.parse(jsonString) as Transcript; // to remove

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
