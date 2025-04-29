// Application entry point
import {
  SCREENSHOTS_PER_SEGMENT,
  TRANSCRIPTION_SEGMENT_INTERVAL,
} from "./config";
import { extractScreenshots } from "./pipeline/screenshot";
import { getTranscriptsByInterval } from "./services/transcriptionService";
import {
  AudioToTranscriptResponse,
  DownloadVideoResponse,
  ExtractScreenshotResponse,
  PromptSegment,
  VideoProcessMessage,
  VideoToAudioResponse,
} from "./types";
import fs from "fs";
import { getPrompSegments, preparePromptMessages } from "./pipeline/prompt";
import { downloadVideos } from "./pipeline/download";
import { unwrapResponse } from "./utils/utils";
import { videosToAudios } from "./pipeline/audio";
import { audiosToTranscripts } from "./pipeline/transcript";
import { uploadScreenshotsToCloud } from "./pipeline/upload";
import { cleanUp } from "./pipeline/cleanup";
import { generateClips } from "./pipeline/llm";
import logger from "./utils/logger";

export async function runPipeline(message: { Body: string }) {
  const messageBody: VideoProcessMessage = JSON.parse(message.Body);

  // Step 1: Download videos
  logger.info("Download Step");
  const dvRes: DownloadVideoResponse = await downloadVideos(messageBody.videos);
  const dvData = unwrapResponse(dvRes);
  if (!dvData) return;

  // Step 2: Videos To Audio
  logger.info("Video to audio step");
  const vaRes: VideoToAudioResponse = await videosToAudios(dvData.videoPaths);
  const vaData = unwrapResponse(vaRes);
  if (!vaData) return;

  // Step 3: Audios To Transcripts
  logger.info("Audio to transcript step");
  const atRes: AudioToTranscriptResponse = await audiosToTranscripts(
    vaData.audioPaths
  );
  const atData = unwrapResponse(atRes);
  if (!atData) return;

  // Step 4: Transcripts To Segments
  // transcriptSegments array contains an array of transcripts for each video, seperated by interval
  logger.info("Segmentation step");
  const transcriptSegments = atData.transcripts.map((transcript) =>
    getTranscriptsByInterval(transcript, TRANSCRIPTION_SEGMENT_INTERVAL * 1000)
  );

  // Step 5: Screenshots Extraction From Videos
  logger.info("Screenshots step");
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
  if (!esData) return;

  // Step 6: Prepare prompt segments
  const allPromptSegments: PromptSegment[][] = [];
  for (let i = 0; i < messageBody.videos.length; i++) {
    const videoTranscriptSegments = transcriptSegments[i];
    const videoScreenshots = esData.screenshotPaths[i];
    const totalSegments = videoTranscriptSegments.length;
    // if(videoScreenshots.length !== totalSegments * SCREENSHOTS_PER_SEGMENT) {
    //   logger.error("Unkown error");
    //   continue
    // }
    const screenshotUrls = await uploadScreenshotsToCloud(videoScreenshots);
    const prompSegments = getPrompSegments(
      videoTranscriptSegments,
      screenshotUrls,
      SCREENSHOTS_PER_SEGMENT
    );
    allPromptSegments.push(prompSegments);
  }

  // Step 7: Prepare prompt messages
  logger.info("Prepare prompt step");
  const promptMessages = preparePromptMessages(allPromptSegments, 20);

  // Step 8: Prompt LLM
  logger.info("prompt step");
  const response = await generateClips(promptMessages);

  fs.writeFile("response.json", JSON.stringify(response), "utf8", (err) => {});

  // Step 10: Create Clips

  // Step 11: Get Final Clip Transcript
  
  // Step 12: Overlay Transcript
  
  // Step 13: Cleanup
  await cleanUp(
    [...dvData.videoPaths, ...vaData.audioPaths],
    allPromptSegments.flat().flatMap((segment) => segment.images)
  );

  // if (message.ReceiptHandle) await deleteMessage(message.ReceiptHandle);
}
