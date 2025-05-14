// Application entry point
import {
  SCREENSHOTS_PER_SEGMENT,
  TRANSCRIPTION_SEGMENT_INTERVAL,
} from "./config";
import { extractScreenshots } from "./pipeline/screenshot";
import {
  createEmptyTranscriptSegments,
  getSubtitles,
  getTranscriptsByInterval,
} from "./services/transcriptionService";
import {
  AudioToTranscriptResponse,
  DownloadVideoResponse,
  ExtractScreenshotResponse,
  FinalResponse,
  PromptSegment,
  PromptType,
  TranscriptInternal,
  VideoPathWithDuration,
  VideoProcessMessage,
  VideoToAudioResponse,
} from "./types";
import fs from "fs";
import { getPrompSegments, preparePromptMessages } from "./pipeline/prompt";
import { downloadVideos, getVideoDurations } from "./pipeline/download";
import { errorResponse, unwrapResponse } from "./utils/utils";
import { videosToAudios } from "./pipeline/audio";
import { audiosToTranscripts } from "./pipeline/transcript";
import { uploadFileByPath, uploadScreenshotsToCloud } from "./pipeline/upload";
import { cleanUp } from "./pipeline/cleanup";
import { generateClips } from "./pipeline/llm";
import logger from "./utils/logger";
import { filterClips, generateFinalClip } from "./pipeline/clip";
import fsP from "fs/promises";
import { burnCaptions } from "./pipeline/caption";
import { Clips } from "./schemas/clips";
import { Transcript } from "assemblyai";
import { getRandomFileName, uploadFile } from "./services/s3Service";

export async function runPipeline(message: {
  Body: string;
}): Promise<FinalResponse> {
  const messageBody: VideoProcessMessage = JSON.parse(message.Body);

  let promptType: PromptType = messageBody.promptType;
  // Step 1: Download videos
  logger.info("Download Step");
  // const dvRes: DownloadVideoResponse = await downloadVideos(messageBody.videos);
  // const dvData = unwrapResponse(dvRes);
  // if (!dvData) return errorResponse(dvRes.message);

  // Step 2: Videos To Audio
  const dvData = {
    videoPaths: Array.from(
      { length: 8 },
      (_, index) => `tmp/video-${index + 1}.mp4`
    ),
  };
  const videoPathsWithDuration: VideoPathWithDuration[] =
    await getVideoDurations(dvData.videoPaths);

  logger.info("Video to audio step");
  let transcriptSegments: TranscriptInternal[][] = [];
  let audioPaths: string[] = [];
  let transcripts: Transcript[] = [];
  if (promptType !== "screenshot") {
    const vaRes: VideoToAudioResponse = await videosToAudios(dvData.videoPaths);
    const vaData = unwrapResponse(vaRes);
    if (!vaData) return errorResponse(vaRes.message);

    // // Step 3: Audios To Transcripts
    logger.info("Audio to transcript step");
    const atRes: AudioToTranscriptResponse = await audiosToTranscripts(
      vaData.audioPaths
    );
    const atData = unwrapResponse(atRes);
    if (!atData) return errorResponse(atRes.message);
    audioPaths = vaData.audioPaths;
    // const transcriptsStr = await fsP.readFile("transcripts.json", "utf8");
    // const atData = {
    //   transcripts: JSON.parse(transcriptsStr) as Transcript[],
    // };

    // Step 4: Transcripts To Segments
    // transcriptSegments array contains an array of transcripts for each video, seperated by interval
    logger.info("Segmentation step");
    transcriptSegments = atData.transcripts.map((transcript) =>
      getTranscriptsByInterval(
        transcript,
        TRANSCRIPTION_SEGMENT_INTERVAL * 1000
      )
    );
    transcripts = atData.transcripts;

    await fsP.writeFile(
      "transcriptSegments.json",
      JSON.stringify(transcriptSegments),
      "utf8"
    );
  } else {
    transcriptSegments = videoPathsWithDuration.map(
      (videoPathWithDuration, index) =>
        createEmptyTranscriptSegments(
          TRANSCRIPTION_SEGMENT_INTERVAL * 1000,
          videoPathWithDuration.duration
        )
    );
  }

  // Step 5: Screenshots Extraction From Videos
  let screenshotPaths: string[][] = [];
  if (promptType !== "transcript") {
    logger.info("Screenshots step");
    const esRes: ExtractScreenshotResponse = await extractScreenshots(
      videoPathsWithDuration,
      TRANSCRIPTION_SEGMENT_INTERVAL,
      SCREENSHOTS_PER_SEGMENT
    );
    const esData = unwrapResponse(esRes);
    if (!esData) return errorResponse(esRes.message);
    screenshotPaths = esData.screenshotPaths;
    await fsP.writeFile(
      "screenshotPaths.json",
      JSON.stringify(esData.screenshotPaths),
      "utf8"
    );
  }

  // Step 6: Prepare prompt segments
  const allPromptSegments: PromptSegment[][] = [];
  for (let i = 0; i < dvData.videoPaths.length; i++) {
    const videoTranscriptSegments = transcriptSegments[i] ?? [];
    const videoScreenshots = screenshotPaths[i] ?? [];
    // if(videoScreenshots.length !== totalSegments * SCREENSHOTS_PER_SEGMENT) {
    //   logger.error("Unkown error");
    //   continue
    // }
    const screenshotUrls = await uploadScreenshotsToCloud(videoScreenshots);
    const prompSegments = getPrompSegments(
      videoTranscriptSegments,
      screenshotUrls,
      promptType === "transcript" ? 0 : SCREENSHOTS_PER_SEGMENT
    );
    allPromptSegments.push(prompSegments);
  }

  await fsP.writeFile(
    "allPromptSegments.json",
    JSON.stringify(allPromptSegments),
    "utf8"
  );

  // Step 7: Prepare prompt messages
  logger.info("Prepare prompt step");
  const promptMessages = preparePromptMessages(
    allPromptSegments,
    TRANSCRIPTION_SEGMENT_INTERVAL,
    SCREENSHOTS_PER_SEGMENT,
    promptType,
    20
  );
  await fsP.writeFile(
    "promptMessages.json",
    JSON.stringify(promptMessages),
    "utf8"
  );

  // Step 8: Prompt LLM
  logger.info("prompt step");
  const response: Clips = await generateClips(promptMessages);

  fs.writeFile("response.json", JSON.stringify(response), "utf8", (err) => {});
  // const response: Clips = JSON.parse(
  //   await fsP.readFile("response.json", "utf8")
  // );
  // Step 10: Generate Final Video
  logger.info("Final video step");
  const fcRes = await generateFinalClip(
    dvData.videoPaths,
    filterClips(videoPathsWithDuration, response),
    "portrait"
  );
  const fcData = unwrapResponse(fcRes);
  if (!fcData) return errorResponse(fcRes.message);
  // Step 11: Cleanup Original Videos and Audios
  logger.info("Temp cleanup step");
  await cleanUp(
    [...dvData.videoPaths, ...audioPaths, ...screenshotPaths.flat()],
    allPromptSegments.flat().flatMap((segment) => segment.images)
  );
  let finalPath = fcData.videoPath;
  if (promptType !== "screenshot") {
    // Step 12: Get Final Video Subtitiles
    logger.info("Final video transcript step");
    const fAtRes: AudioToTranscriptResponse = await audiosToTranscripts([
      fcData.audioPath,
    ]);
    const fAtData = unwrapResponse(fAtRes);
    if (!fAtData) return errorResponse(fAtRes.message);
    const transcript = transcripts[0];
    const subtitles = await getSubtitles(transcript.id);
    // const subtitles = await fsP.readFile("subtitles.txt", "utf8");
    await fsP.writeFile("subtitles.txt", "utf8");

    // Step 13: Overlay Captions
    logger.info("Final video captions step");
    finalPath = `${getRandomFileName()}_final.mp4`;
    await burnCaptions(fcData.videoPath, subtitles, finalPath);
  }
  // // Step 14: Upload result to storage service
  const resultUrl = await uploadFileByPath(finalPath);
  await cleanUp([fcData.videoPath], []);
  return { status: "success", data: { resultUrl } };
  // if (message.ReceiptHandle) await deleteMessage(message.ReceiptHandle);
}
