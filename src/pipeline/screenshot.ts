import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { randomInt } from "crypto";
import { TMP_DIR } from "../config";
import logger from "../utils/logger";
import { ExtractScreenshotResponse } from "../types";

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
        size: "640x?",
      })
      .on("end", () => {
        try {
          if (fs.existsSync(screenshotPath)) {
            console.log("[screenshot] Screenshot extraction completed");
            resolve(screenshotPath);
          } else {
            reject(new Error("Screenshot not found at expected location."));
          }
        } catch (err) {
          console.error("[screenshot] Error reading file:", err);
          reject(err);
        }
      })
      .on("error", (err) => {
        console.error("[screenshot] FFmpeg failed:", err.message);
        reject(err);
      });
  });
}

export async function extractScreenshots(
  videosWithDuration: { path: string; duration: number }[],
  intervalSeconds: number,
  screenshotsPerInterval: number
): Promise<ExtractScreenshotResponse> {
  try {
    const intervalMs = intervalSeconds * 1000;
    const screenshotPaths: string[][] = [];
    await Promise.all(
      videosWithDuration.map(async (videoWithDuration) => {
        const path = videoWithDuration.path;
        const durationMs = videoWithDuration.duration * 1000;
        const scPaths = [];
        for (let i = 0; i < durationMs; i += intervalMs) {
          const delta = intervalMs / screenshotsPerInterval;
          for (let j = 0; j < intervalMs; j += delta) {
            const start = i + j;
            const end = i + j + delta > durationMs ? durationMs : i + j + delta;
            scPaths.push(await extractRandomScreenshot(path, start, end));
          }
        }
        screenshotPaths.push(scPaths);
      })
    );
    return { status: "success", data: { screenshotPaths } };
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
