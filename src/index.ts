// Application entry point
import {
  SCREENSHOTS_PER_SEGMENT,
  TRANSCRIPTION_SEGMENT_INTERVAL,
} from "./config";
import { extractScreenshots } from "./pipeline/screenshot";
import { getTranscriptsByInterval } from "./services/transcription";
import {
  AudioToTranscriptResponse,
  DownloadVideoResponse,
  ExtractScreenshotResponse,
  VideoProcessMessage,
  VideoToAudioResponse,
} from "./types";
import { logger } from "./utils/logger";
import fs from "fs";
import { getPrompSegments } from "./pipeline/prompt";
import { downloadVideos } from "./pipeline/download";
import { unwrapResponse } from "./utils/utils";
import { videosToAudios } from "./pipeline/audio";
import { audiosToTranscripts } from "./pipeline/transcript";

async function main() {
  try {
    // const messages = await retrieveMessages()
    const messages = [
      {
        Body: JSON.stringify({
          videos: [
            {
              url: "https://drive.usercontent.google.com/download?id=1RCyBoG1oMjE0HtDoz593Pp-kDhh2nOva&export=download&authuser=0&confirm=t&uuid=7df1150e-cc0e-43e6-9d94-124261ce4cf3&at=APcmpox_cwg8sovHu0wNO2LWjx1Q:1745509832769",
            },
          ],
        }),
      },
    ];
    // while (true) {
    for (const message of messages) {
      try {
        if (message.Body) {
          const messageBody: VideoProcessMessage = JSON.parse(message.Body);

          // Step 1: Download videos
          const dvRes: DownloadVideoResponse = await downloadVideos(
            messageBody.videos
          );
          const dvData = unwrapResponse(dvRes);
          if (!dvData) continue;

          // Step 2: Videos To Audio
          const vaRes: VideoToAudioResponse = await videosToAudios(
            dvData.videoPaths
          );
          const vaData = unwrapResponse(vaRes);
          if (!vaData) continue;

          // Step 3: Audios To Transcripts
          const atRes: AudioToTranscriptResponse = await audiosToTranscripts(
            vaData.audioPaths
          );
          const atData = unwrapResponse(atRes);
          if (!atData) continue;

          // Step 4: Transcripts To Segments
          // transcriptSegments array contains an array of transcripts for each video, seperated by interval
          const transcriptSegments = atData.transcripts.map((transcript) =>
            getTranscriptsByInterval(transcript, TRANSCRIPTION_SEGMENT_INTERVAL)
          );

          // Step 5: Screenshots Extraction From Videos
          const esRes: ExtractScreenshotResponse = await extractScreenshots(
            dvData.videoPaths.map((videoPath, index) => {
              const transcript = atData.transcripts[index];
              return {
                path: videoPath,
                duration: transcript.audio_duration! - 1,
              };
            }),
            TRANSCRIPTION_SEGMENT_INTERVAL,
            SCREENSHOTS_PER_SEGMENT
          );
          const esData = unwrapResponse(esRes);
          if (!esData) continue;

          for (let i = 0; i < messageBody.videos.length; i++) {
            const videoTranscriptSegments = transcriptSegments[i];
            const videoScreenshots = esData.screenshotPaths[i];
            const totalSegments = videoTranscriptSegments.length;
            // if(videoScreenshots.length !== totalSegments * SCREENSHOTS_PER_SEGMENT) {
            //   logger.error("Unkown error");
            //   continue
            // }
            const prompSegments = getPrompSegments(
              videoTranscriptSegments,
              videoScreenshots,
              SCREENSHOTS_PER_SEGMENT
            );
            fs.writeFile(
              "prompSegments.json",
              JSON.stringify(prompSegments),
              "utf8",
              (err) => {}
            );
            console.log(JSON.stringify(prompSegments));
          }

          // if (message.ReceiptHandle) await deleteMessage(message.ReceiptHandle);
        }
      } catch (err) {
        continue;
      } finally {

      }
    }
    // }
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("Application failed", { error: errorMessage });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { main };
