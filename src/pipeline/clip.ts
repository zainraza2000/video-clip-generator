import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as util from "util";
import logger from "../utils/logger";
import { FinalClipResponse, VideoResultType } from "../types";
import { Transcript } from "assemblyai";
import { Clips } from "../schemas/clips";
import os from "os";

// Promisified versions of fs functions
const mkdirPromise = util.promisify(fs.mkdir);
const unlinkPromise = util.promisify(fs.unlink);
const existsPromise = util.promisify(fs.exists);

// Define target aspect ratios
const ASPECT_RATIOS = {
  portrait: 9 / 16, // 9:16 for portrait (e.g., 1080x1920)
  landscape: 16 / 9, // 16:9 for landscape (e.g., 1920x1080)
};

// Target resolutions
const TARGET_RESOLUTIONS = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
};

// Cache for video metadata to avoid repeated probing
const videoInfoCache = new Map();

// Helper function to get video info with caching
const getVideoInfo = async (
  videoPath: string
): Promise<{
  width: number;
  height: number;
  frameRate: string;
  sampleRate: number;
}> => {
  // Return from cache if available
  if (videoInfoCache.has(videoPath)) {
    return videoInfoCache.get(videoPath);
  }

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        logger.error(`Failed to probe video ${videoPath}: ${err}`, {
          service: "clip-service",
        });
        // Return default values if probing fails
        const defaultInfo = {
          width: 1280,
          height: 720,
          frameRate: "30/1",
          sampleRate: 44100,
        };
        videoInfoCache.set(videoPath, defaultInfo);
        resolve(defaultInfo);
        return;
      }

      try {
        const videoStream = metadata.streams.find(
          (s) => s.codec_type === "video"
        );
        const audioStream = metadata.streams.find(
          (s) => s.codec_type === "audio"
        );

        const info = {
          width: videoStream?.width || 1280,
          height: videoStream?.height || 720,
          frameRate: videoStream?.r_frame_rate || "30/1",
          sampleRate: audioStream?.sample_rate || 44100,
        };

        // Cache the result
        videoInfoCache.set(videoPath, info);
        resolve(info);
      } catch (error) {
        logger.error(`Error parsing video metadata: ${error}`, {
          service: "clip-service",
        });
        const defaultInfo = {
          width: 1280,
          height: 720,
          frameRate: "30/1",
          sampleRate: 44100,
        };
        videoInfoCache.set(videoPath, defaultInfo);
        resolve(defaultInfo);
      }
    });
  });
};

export function filterClips(transcripts: Transcript[], clips: Clips) {
  const filteredClips = clips
    .filter(
      (clip) => transcripts[clip.index]?.audio_duration && clip.start >= 0
    )
    .map((clip) => {
      const audio_duration = transcripts[clip.index].audio_duration;
      let end = clip.end;
      if (end > audio_duration! * 1000) {
        end = audio_duration! * 1000;
      }
      return { ...clip, end };
    });

  return filteredClips;
}

// Optimized helper function to create a padded clip with blurred background
const createPaddedClip = async (
  sourceVideo: string,
  outputPath: string,
  startTime: number,
  duration: number,
  resultType: VideoResultType
): Promise<boolean> => {
  return new Promise(async (resolve) => {
    try {
      // Get the source video info
      const videoInfo = await getVideoInfo(sourceVideo);
      const sourceAspectRatio = videoInfo.width / videoInfo.height;
      const targetAspectRatio = ASPECT_RATIOS[resultType];
      const targetResolution = TARGET_RESOLUTIONS[resultType];

      // Extract framerate as a numeric value for consistency
      const frameRateParts = videoInfo.frameRate.split("/");
      const targetFps = Math.round(
        parseInt(frameRateParts[0]) / parseInt(frameRateParts[1])
      );

      logger.info(`Processing video: ${path.basename(sourceVideo)}`, {
        service: "clip-service",
        dimensions: `${videoInfo.width}x${videoInfo.height}`,
        targetResolution: `${targetResolution.width}x${targetResolution.height}`,
        fps: targetFps,
      });

      try {
        // Improved filter chain for better quality
        let filterCommand;

        // Calculate blur based on resolution but with better quality/performance balance
        const blurAmount = Math.min(
          20,
          Math.max(8, Math.floor(targetResolution.width / 150))
        );

        // More efficient filter chain with downscaling before blur for performance
        filterCommand =
          `[0:v]split=2[original][forblur];` +
          // Downscale before blur for better performance
          `[forblur]scale=${targetResolution.width / 2}:${
            targetResolution.height / 2
          },` +
          `boxblur=${blurAmount}:2,scale=${targetResolution.width}:${targetResolution.height}[blurred];` +
          `[original]`;

        // Add the appropriate scaling based on orientation and source aspect ratio
        if (resultType === "portrait") {
          if (sourceAspectRatio > targetAspectRatio) {
            filterCommand += `scale=${targetResolution.width}:-1`;
          } else {
            filterCommand += `scale=-1:${targetResolution.height}`;
          }
        } else {
          filterCommand += `scale=-1:${targetResolution.height}`;
        }

        // Add fps filter to ensure consistent frame rate
        filterCommand += `,fps=fps=${targetFps}`;

        // Complete the filter command with the overlay
        filterCommand +=
          `[scaled];` + `[blurred][scaled]overlay=(W-w)/2:(H-h)/2`;

        // Create the clip with balanced quality/speed settings
        const command = ffmpeg(sourceVideo)
          .setStartTime(startTime)
          .setDuration(duration)
          .videoFilter(filterCommand)
          .outputOptions([
            "-c:v libx264",
            // Better balanced preset
            "-preset medium",
            // Better quality CRF
            "-crf 22",
            // Better audio handling
            "-c:a aac",
            "-b:a 192k",
            "-vsync 1",
            "-async 1",
            `-ar ${videoInfo.sampleRate}`,
            "-movflags +faststart",
            "-threads 0",
          ]);

        // Log progress but less frequently
        command.on("progress", (progress) => {
          if (progress.percent && progress.percent % 20 === 0) {
            logger.info(`Processing clip: ${Math.round(progress.percent)}%`, {
              service: "clip-service",
            });
          }
        });

        command.on("error", (err, stdout, stderr) => {
          logger.error(`Error creating padded clip: ${err.message}`, {
            service: "clip-service",
          });

          // Better fallback with reasonable quality
          logger.info("Attempting fallback with simpler approach...", {
            service: "clip-service",
          });

          ffmpeg(sourceVideo)
            .setStartTime(startTime)
            .setDuration(duration)
            .outputOptions([
              `-vf scale=${targetResolution.width}:${targetResolution.height}:force_original_aspect_ratio=1,` +
                `pad=${targetResolution.width}:${targetResolution.height}:(ow-iw)/2:(oh-ih)/2,fps=fps=${targetFps}`,
              "-c:v libx264",
              "-preset fast", // Better fallback preset
              "-crf 23", // Better quality but still fast
              "-c:a aac",
              "-b:a 128k",
              "-vsync 1",
              "-async 1",
              "-threads 0",
            ])
            .on("error", (fallbackErr) => {
              logger.error(`Fallback scaling failed: ${fallbackErr}`, {
                service: "clip-service",
              });
              resolve(false);
            })
            .on("end", () => {
              logger.info("Fallback scaling succeeded", {
                service: "clip-service",
              });
              resolve(true);
            })
            .save(outputPath);
        });

        command.on("end", () => {
          logger.info(`Created clip: ${path.basename(outputPath)}`, {
            service: "clip-service",
          });
          resolve(true);
        });

        // Run the command
        command.save(outputPath);
      } catch (ffmpegErr) {
        logger.error(`Exception in FFmpeg processing: ${ffmpegErr}`, {
          service: "clip-service",
        });
        resolve(false);
      }
    } catch (err) {
      logger.error(`Exception in createPaddedClip: ${err}`, {
        service: "clip-service",
      });
      resolve(false);
    }
  });
};
/**
 * Concatenates multiple video clips into a single video and creates an audio version
 * @param clipPaths Array of paths to video clips to concatenate
 * @param outputVideoPath Path to save the concatenated video
 * @param outputAudioPath Path to save the extracted audio
 * @returns Promise resolving to true on success, false on failure
 */
const concatenateClips = async (
  clipPaths: string[],
  outputVideoPath: string,
  outputAudioPath: string
): Promise<boolean> => {
  // Early validation
  if (clipPaths.length === 0) {
    logger.error("No clip paths provided for concatenation", {
      service: "clip-service",
    });
    return false;
  }

  // Handle single clip case more efficiently
  if (clipPaths.length === 1) {
    return handleSingleClip(clipPaths[0], outputVideoPath, outputAudioPath);
  }

  // For multiple clips, first get metadata from first clip
  try {
    const metadata = await getVideoMetadata(clipPaths[0]);
    const targetFps = calculateFrameRate(metadata);
    return await performConcatenation(
      clipPaths,
      outputVideoPath,
      outputAudioPath,
      targetFps
    );
  } catch (err) {
    logger.error(`Failed during concatenation process: ${err}`, {
      service: "clip-service",
    });
    // Try with default settings as final fallback
    return await performConcatenation(
      clipPaths,
      outputVideoPath,
      outputAudioPath
    );
  }
};

/**
 * Get video metadata using ffprobe
 */
const getVideoMetadata = (clipPath: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(clipPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(metadata);
    });
  });
};

/**
 * Calculate target frame rate from metadata
 */
const calculateFrameRate = (metadata: any): number => {
  try {
    const videoStream = metadata.streams.find(
      (s: any) => s.codec_type === "video"
    );
    if (!videoStream || !videoStream.r_frame_rate) {
      return 30; // Default if not found
    }

    const frameRateParts = videoStream.r_frame_rate.split("/");
    return Math.round(
      parseInt(frameRateParts[0]) / parseInt(frameRateParts[1])
    );
  } catch (e) {
    logger.warn(`Error calculating frame rate, using default: ${e}`, {
      service: "clip-service",
    });
    return 30;
  }
};

/**
 * Handle the simple case of a single clip
 */
const handleSingleClip = (
  clipPath: string,
  outputVideoPath: string,
  outputAudioPath: string
): Promise<boolean> => {
  return new Promise((resolve) => {
    // For single clips, use copy codec to avoid re-encoding
    ffmpeg(clipPath)
      .outputOptions(["-c copy", "-map 0", "-threads 0"])
      .output(outputVideoPath)
      .on("error", (err) => {
        logger.error(`Error copying video: ${err}`, {
          service: "clip-service",
        });
        resolve(false);
      })
      .on("end", async () => {
        try {
          await extractAudio(outputVideoPath, outputAudioPath);
          resolve(true);
        } catch (err) {
          // Continue even if audio extraction fails
          logger.warn(`Audio extraction failed but video succeeded: ${err}`, {
            service: "clip-service",
          });
          resolve(true);
        }
      })
      .run();
  });
};

/**
 * Extract audio from video
 */
const extractAudio = (videoPath: string, audioPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions(["-vn", "-c:a libmp3lame", "-q:a 3", "-threads 0"])
      .output(audioPath)
      .on("error", reject)
      .on("end", () => resolve())
      .run();
  });
};

/**
 * Perform the actual concatenation with primary and fallback strategies
 */
const performConcatenation = async (
  clipPaths: string[],
  outputVideoPath: string,
  outputAudioPath: string,
  fps: number = 30
): Promise<boolean> => {
  // Try filter complex approach first
  const filterSuccess = await tryFilterComplexConcatenation(
    clipPaths,
    outputVideoPath,
    fps
  );

  // If filter complex failed, try concat demuxer approach
  if (!filterSuccess) {
    const demuxerSuccess = await tryConcatDemuxerConcatenation(
      clipPaths,
      outputVideoPath
    );
    if (!demuxerSuccess) {
      return false;
    }
  }

  // At this point, we have a successful video concatenation, extract audio
  try {
    await extractAudio(outputVideoPath, outputAudioPath);
    return true;
  } catch (err) {
    // Continue even if audio extraction fails
    logger.warn(`Audio extraction failed but video succeeded: ${err}`, {
      service: "clip-service",
    });
    return true;
  }
};

/**
 * Try concatenation using the filter complex approach (most reliable)
 */
const tryFilterComplexConcatenation = (
  clipPaths: string[],
  outputPath: string,
  fps: number
): Promise<boolean> => {
  return new Promise((resolve) => {
    try {
      // Build the concat command
      const command = ffmpeg();

      // Add all input files
      clipPaths.forEach((clip) => {
        command.input(clip);
      });

      // Create filter complex string for consistent frame rate
      const filterComplex = [
        // Ensure consistent frame rate and scaling for all inputs
        ...clipPaths.map((_, i) => `[${i}:v]fps=fps=${fps}[v${i}]`),
        // Concatenate video streams
        clipPaths.map((_, i) => `[v${i}][${i}:a]`).join("") +
          `concat=n=${clipPaths.length}:v=1:a=1[outv][outa]`,
      ];

      command.complexFilter(filterComplex);

      // Set output options
      command.outputOptions([
        "-map [outv]",
        "-map [outa]",
        "-c:v libx264",
        "-preset medium",
        "-crf 22",
        "-c:a aac",
        "-b:a 192k",
        "-movflags +faststart",
        "-threads 0",
      ]);

      command.output(outputPath);

      // Handle errors and completion
      command.on("error", (err) => {
        logger.warn(`Filter complex concatenation failed: ${err}`, {
          service: "clip-service",
        });
        resolve(false);
      });

      command.on("end", () => {
        logger.info("Filter complex concatenation successful", {
          service: "clip-service",
        });
        resolve(true);
      });

      command.run();
    } catch (err) {
      logger.error(`Exception in filter complex concatenation: ${err}`, {
        service: "clip-service",
      });
      resolve(false);
    }
  });
};

/**
 * Try concatenation using the concat demuxer approach (fallback)
 */
const tryConcatDemuxerConcatenation = (
  clipPaths: string[],
  outputPath: string
): Promise<boolean> => {
  return new Promise((resolve) => {
    try {
      // Create a temporary file that lists all clips to concatenate
      const tempDir = path.join(process.cwd(), "tmp");
      // Ensure temp directory exists
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const listFilePath = path.join(tempDir, `concat_list_${Date.now()}.txt`);

      // Create file content listing all clips
      const fileContent = clipPaths
        .map((clip) => {
          return `file '${clip.replace(/'/g, "'\\''")}'`;
        })
        .join("\n");

      // Write the file
      fs.writeFileSync(listFilePath, fileContent);

      // Run the concat command
      ffmpeg()
        .input(listFilePath)
        .inputOptions(["-f concat", "-safe 0"])
        .outputOptions([
          "-c:v libx264",
          "-preset medium",
          "-crf 22",
          "-c:a aac",
          "-b:a 192k",
          "-vsync 1",
          "-async 1",
          "-threads 0",
        ])
        .output(outputPath)
        .on("error", (err) => {
          logger.error(`Concat demuxer concatenation failed: ${err}`, {
            service: "clip-service",
          });
          // Clean up temp file
          try {
            fs.unlinkSync(listFilePath);
          } catch (e) {
            // Ignore cleanup errors
          }
          resolve(false);
        })
        .on("end", () => {
          logger.info("Concat demuxer concatenation successful", {
            service: "clip-service",
          });
          // Clean up temp file
          try {
            fs.unlinkSync(listFilePath);
          } catch (e) {
            // Ignore cleanup errors
          }
          resolve(true);
        })
        .run();
    } catch (err) {
      logger.error(`Exception in concat demuxer concatenation: ${err}`, {
        service: "clip-service",
      });
      resolve(false);
    }
  });
};
/**
 * Optimized function that generates a final clip from multiple video segments with specified aspect ratio
 * @param videoPaths Array of paths to source videos
 * @param clips Array of clip definitions with start, end, order, and index properties
 * @param resultType The desired aspect ratio, either 'portrait' or 'landscape'
 * @returns FinalClipResponse with status and output paths
 */
export async function generateFinalClip(
  videoPaths: string[],
  clips: Clips,
  resultType: VideoResultType = "portrait"
): Promise<FinalClipResponse> {
  // Create temp directory for storing clip segments
  const start = new Date();
  const tempDir = path.join(process.cwd(), "tmp");
  const clipPaths: string[] = [];

  try {
    // Create temp directory if it doesn't exist
    await mkdirPromise(tempDir, { recursive: true }).catch((err) => {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        logger.warn(`Failed to create temp directory: ${err}`, {
          service: "clip-service",
        });
      }
    });

    // Sort clips by their order property
    const orderedClips = [...clips].sort((a, b) => a.order - b.order);

    // Input validation - fail fast
    if (orderedClips.length === 0) {
      logger.error("No clips provided to generate final clip", {
        service: "clip-service",
      });
      return { status: "error", message: "No clips provided" };
    }

    if (videoPaths.length === 0) {
      logger.error("No video paths provided to generate clips from", {
        service: "clip-service",
      });
      return { status: "error", message: "No video paths provided" };
    }

    // Preload video info in parallel for all videos to avoid sequential probing
    await Promise.all(
      videoPaths.map(async (videoPath) => {
        if (await existsPromise(videoPath)) {
          await getVideoInfo(videoPath);
        }
      })
    );

    // Determine optimal concurrency based on CPU cores
    const cpuCount = os.cpus().length;
    const MAX_CONCURRENT_PROCESSES = Math.max(1, Math.min(cpuCount - 1, 4)); // Leave 1 core free, max 4

    logger.info(
      `Processing clips with ${MAX_CONCURRENT_PROCESSES} concurrent processes`,
      { service: "clip-service" }
    );

    // Create clips in parallel with concurrency control
    // Each batch will process MAX_CONCURRENT_PROCESSES clips at once
    for (let i = 0; i < orderedClips.length; i += MAX_CONCURRENT_PROCESSES) {
      const batch = orderedClips.slice(i, i + MAX_CONCURRENT_PROCESSES);
      const batchPromises = batch.map(async (clip, batchIndex) => {
        try {
          const clipIndex = i + batchIndex;
          const videoIndex = clip.index;

          // Skip if invalid video index
          if (videoIndex < 0 || videoIndex >= videoPaths.length) {
            logger.error(
              `Invalid video index ${videoIndex} for clip at order ${clip.order}`,
              { service: "clip-service" }
            );
            return null;
          }

          const sourceVideo = videoPaths[videoIndex];

          // Skip if video path doesn't exist
          if (!(await existsPromise(sourceVideo))) {
            logger.error(`Video not found at path: ${sourceVideo}`, {
              service: "clip-service",
            });
            return null;
          }

          const clipFilename = path.join(
            tempDir,
            `clip_${clipIndex}_${Date.now()}.mp4`
          );

          // Calculate duration in seconds
          const startSec = clip.start / 1000;
          const durationSec = (clip.end - clip.start) / 1000;

          // Skip if invalid duration
          if (durationSec <= 0) {
            logger.error(
              `Invalid clip duration for clip at order ${clip.order}: ${durationSec}s`,
              { service: "clip-service" }
            );
            return null;
          }

          logger.info(
            `Processing clip ${clipIndex + 1}/${
              orderedClips.length
            } from ${path.basename(sourceVideo)}`,
            { service: "clip-service" }
          );

          // Create the padded clip
          const success = await createPaddedClip(
            sourceVideo,
            clipFilename,
            startSec,
            durationSec,
            resultType
          );
          return success ? clipFilename : null;
        } catch (error) {
          logger.error(`Error in clip batch processing: ${error}`, {
            service: "clip-service",
          });
          return null;
        }
      });

      // Wait for the current batch to complete before starting the next one
      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach((path) => {
        if (path) clipPaths.push(path);
      });
    }

    // If no clips were successfully created, return error
    if (clipPaths.length === 0) {
      logger.error("Failed to create any clips", { service: "clip-service" });
      return { status: "error", message: "Failed to create any clips" };
    }

    // Define output paths
    const outputVideoPath = path.join(process.cwd(), "final_clip.mp4");
    const outputAudioPath = path.join(process.cwd(), "final_clip.mp3");

    // Concatenate the clips
    logger.info(
      `Concatenating ${clipPaths.length} clips into final ${resultType} video`,
      { service: "clip-service" }
    );
    const concatSuccess = await concatenateClips(
      clipPaths,
      outputVideoPath,
      outputAudioPath
    );

    if (concatSuccess) {
      logger.info(`Final ${resultType} clip generated successfully`, {
        service: "clip-service",
      });
      const end = new Date();
      logger.info(`${end.getTime() - start.getTime()}`);
      return {
        status: "success",
        data: {
          videoPath: outputVideoPath,
          audioPath: outputAudioPath,
        },
      };
    } else {
      // If concatenation failed but we have at least one clip, use that as fallback
      if (clipPaths.length > 0) {
        logger.warn("Concatenation failed, using first clip as fallback", {
          service: "clip-service",
        });

        try {
          // Copy the first clip as the final output
          fs.copyFileSync(clipPaths[0], outputVideoPath);

          // Create audio from the first clip
          await new Promise<void>((resolve) => {
            ffmpeg(clipPaths[0])
              .output(outputAudioPath)
              .outputOptions(["-vn", "-c:a libmp3lame", "-q:a 4", "-threads 0"])
              .on("error", (err) => {
                logger.error(
                  `Error extracting audio from fallback clip: ${err}`,
                  { service: "clip-service" }
                );
                resolve();
              })
              .on("end", () => {
                resolve();
              })
              .run();
          });

          logger.info(`Fallback clip used as final output`, {
            service: "clip-service",
          });

          return {
            status: "success",
            data: {
              videoPath: outputVideoPath,
              audioPath: outputAudioPath,
            },
          };
        } catch (err) {
          logger.error(`Error using fallback clip: ${err}`, {
            service: "clip-service",
          });
        }
      }

      return { status: "error", message: "Failed to concatenate clips" };
    }
  } catch (error) {
    logger.error(`Error generating final clip: ${error}`, {
      service: "clip-service",
    });
    return { status: "error", message: JSON.stringify(error) };
  } finally {
    // Clean up temporary files in the background to not block the response
    setTimeout(async () => {
      try {
        await Promise.all(
          clipPaths.map(async (clipPath) => {
            if (await existsPromise(clipPath)) {
              return unlinkPromise(clipPath).catch((err) => {
                logger.warn(`Failed to delete temp file ${clipPath}: ${err}`, {
                  service: "clip-service",
                });
              });
            }
          })
        );
      } catch (cleanupError) {
        logger.warn(`Error during cleanup: ${cleanupError}`, {
          service: "clip-service",
        });
      }
    }, 1000);
  }
}
