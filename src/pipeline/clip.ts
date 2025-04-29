import { Clips } from "../schemas/clips";
import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as util from "util";
import logger from "../utils/logger";

const execPromise = util.promisify(exec);
const mkdirPromise = util.promisify(fs.mkdir);
const unlinkPromise = util.promisify(fs.unlink);

export async function generateFinalClip(
  videoPaths: string[],
  clips: Clips
): Promise<string> {
  // Create temp directory for storing clip segments
  const tempDir = path.join(process.cwd(), "temp_clips");
  try {
    await mkdirPromise(tempDir, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      throw err;
    }
  }

  // Sort clips by their order property
  const orderedClips = [...clips].sort((a, b) => a.order - b.order);

  // Extract each clip segment
  const clipPaths: string[] = [];

  try {
    // First, get info about the first video to use as a reference for consistent formatting
    const probeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of csv=p=0 "${videoPaths[0]}"`;
    const { stdout: videoInfo } = await execPromise(probeCmd);
    const [width, height, frameRate] = videoInfo.trim().split(",");

    // Get audio sample rate
    const audioProbeCmd = `ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate -of csv=p=0 "${videoPaths[0]}"`;
    const { stdout: audioInfo } = await execPromise(audioProbeCmd);
    const sampleRate = audioInfo.trim();

    for (let i = 0; i < orderedClips.length; i++) {
      const clip = orderedClips[i];
      const sourceVideo = videoPaths[clip.index];

      if (!sourceVideo) {
        throw new Error(
          `Video at index ${clip.index} not found in videoPaths array`
        );
      }

      const clipFilename = path.join(tempDir, `clip_${i}.mp4`);
      clipPaths.push(clipFilename);

      // Calculate duration in seconds
      const startSec = clip.start / 1000;
      const durationSec = (clip.end - clip.start) / 1000;

      // Use FFmpeg to extract the clip with consistent parameters
      // The -async 1 flag helps maintain audio synchronization
      // We're using explicit width, height, frame rate, and sample rate for consistency
      const ffmpegCmd =
        `ffmpeg -i "${sourceVideo}" -ss ${startSec} -t ${durationSec} ` +
        `-c:v libx264 -preset fast -crf 18 -vf "scale=${width}:${height},fps=${frameRate}" ` +
        `-c:a aac -b:a 192k -ar ${sampleRate} -async 1 "${clipFilename}" -y`;

      await execPromise(ffmpegCmd);
    }

    // Use the concat filter instead of the concat demuxer for better audio sync
    const filterComplex = clipPaths
      .map((_, i) => `[${i}:v] [${i}:a]`)
      .join(" ");
    const filterInputs = clipPaths
      .map((_, i) => `-i "${clipPaths[i]}"`)
      .join(" ");

    // Combine all clips into a final video using the concat filter
    const outputPath = path.join(process.cwd(), "finalll_clip.mp4");

    // Using the concat filter with re-encoding for better synchronization
    const concatFilterGraph = `${filterComplex} concat=n=${clipPaths.length}:v=1:a=1 [v] [a]`;
    const concatCmd =
      `ffmpeg ${filterInputs} -filter_complex "${concatFilterGraph}" ` +
      `-map "[v]" -map "[a]" -c:v libx264 -c:a aac -b:a 192k "${outputPath}" -y`;

    logger.info("Joining clips into final video...", {
      service: "clip-service",
    });
    await execPromise(concatCmd);

    logger.info(`Final clip generated: ${outputPath}`, {
      service: "clip-service",
    });
    return outputPath;
  } catch (error) {
    logger.error(`Error generating final clip: ${error}`, {
      service: "clip-service",
    });
    throw error;
  } finally {
    // Clean up temporary files
    try {
      for (const clipPath of clipPaths) {
        if (fs.existsSync(clipPath)) {
          await unlinkPromise(clipPath);
        }
      }

      // Try to remove temp directory
      fs.rmdir(tempDir, { recursive: true }, (err) => {
        if (err)
          logger.warn(`Could not remove temp directory: ${err}`, {
            service: "clip-service",
          });
      });
    } catch (cleanupError) {
      logger.warn(`Error during cleanup: ${JSON.stringify(cleanupError)}`, {
        service: "clip-service",
      });
    }
  }
}