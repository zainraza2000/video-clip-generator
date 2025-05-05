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

      // Optimize logging - reduce unnecessary logs for better performance
      logger.info(`Processing video: ${path.basename(sourceVideo)}`, {
        service: "clip-service",
        dimensions: `${videoInfo.width}x${videoInfo.height}`,
        targetResolution: `${targetResolution.width}x${targetResolution.height}`,
      });

      try {
        // Simplified and optimized filter chain
        let filterCommand;

        // Optimize the blur amount based on resolution to save processing time
        // Lower blur values for faster processing, still effective visually
        const blurAmount = Math.min(
          10,
          Math.max(5, Math.floor(targetResolution.width / 200))
        );

        filterCommand =
          `[0:v]split=2[original][forblur];` +
          `[forblur]scale=${targetResolution.width}:${targetResolution.height},boxblur=${blurAmount}:2[blurred];` +
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

        // Complete the filter command with the overlay
        filterCommand +=
          `[scaled];` + `[blurred][scaled]overlay=(W-w)/2:(H-h)/2`;

        // Create the clip with optimized output options
        const command = ffmpeg(sourceVideo)
          .setStartTime(startTime)
          .setDuration(duration)
          .videoFilter(filterCommand)
          .outputOptions([
            "-c:v libx264",
            // Choose encoding preset based on clip duration for speed/quality balance
            duration > 10 ? "-preset veryfast" : "-preset ultrafast",
            // Slightly increase CRF for speed (lower quality but faster)
            "-crf 25",
            "-c:a aac",
            "-b:a 128k", // Lower bitrate for faster processing
            `-ar ${videoInfo.sampleRate}`,
            "-movflags +faststart",
            "-threads 0", // Use maximum threads available
          ]);

        // Reduce logging frequency for better performance
        command.on("progress", (progress) => {
          if (progress.percent && progress.percent % 20 === 0) {
            // Only log every 20%
            logger.info(`Processing clip: ${Math.round(progress.percent)}%`, {
              service: "clip-service",
            });
          }
        });

        command.on("error", (err, stdout, stderr) => {
          logger.error(`Error creating padded clip: ${err.message}`, {
            service: "clip-service",
          });

          // Simpler fallback for faster processing
          logger.info("Attempting fallback with simpler scaling...", {
            service: "clip-service",
          });

          // Use a simpler approach with less blur for the fallback
          ffmpeg(sourceVideo)
            .setStartTime(startTime)
            .setDuration(duration)
            .outputOptions([
              `-vf scale=${targetResolution.width}:${targetResolution.height}:force_original_aspect_ratio=1,pad=${targetResolution.width}:${targetResolution.height}:(ow-iw)/2:(oh-ih)/2`,
              "-c:v libx264",
              "-preset ultrafast",
              "-crf 28", // Higher CRF for faster encoding
              "-c:a aac",
              "-b:a 128k", // Lower audio bitrate
              "-threads 0", // Maximum threads
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

// Optimized helper function to concatenate clips using more efficient method
const concatenateClips = async (
  clipPaths: string[],
  outputVideoPath: string,
  outputAudioPath: string
): Promise<boolean> => {
  return new Promise((resolve) => {
    try {
      // Check if we have clips to concatenate
      if (clipPaths.length === 0) {
        logger.error("No clip paths provided for concatenation", {
          service: "clip-service",
        });
        resolve(false);
        return;
      }

      // If we only have one clip, just copy it as the final output
      if (clipPaths.length === 1) {
        const command = ffmpeg(clipPaths[0]);

        // Use copy codec to avoid re-encoding for better performance
        command
          .output(outputVideoPath)
          .outputOptions([
            "-c copy", // Direct stream copy without re-encoding
            "-threads 0", // Use all available threads
          ])
          .on("error", (err) => {
            logger.error(`Error copying video: ${err}`, {
              service: "clip-service",
            });
            resolve(false);
          })
          .on("end", () => {
            // After video is created, extract audio in a separate step
            ffmpeg(outputVideoPath)
              .output(outputAudioPath)
              .outputOptions([
                "-vn",
                "-c:a libmp3lame",
                "-q:a 4", // Lower quality for faster encoding
                "-threads 0", // Use all available threads
              ])
              .on("error", (err) => {
                logger.error(`Error extracting audio: ${err}`, {
                  service: "clip-service",
                });
                // Continue even if audio extraction fails
                resolve(true);
              })
              .on("end", () => {
                resolve(true);
              })
              .run();
          })
          .run();
        return;
      }

      // Optimized concatenation - using the concat demuxer for more efficiency
      const listFilePath = path.join(
        process.cwd(),
        "tmp",
        `concat_list_${Date.now()}.txt`
      );
      let fileContent = "";
      clipPaths.forEach((clip) => {
        fileContent += `file '${clip.replace(/'/g, "'\\''")}'` + "\n";
      });

      try {
        fs.writeFileSync(listFilePath, fileContent);
      } catch (err) {
        logger.error(`Error writing concat list file: ${err}`, {
          service: "clip-service",
        });
        if (clipPaths.length > 0) {
          fs.copyFileSync(clipPaths[0], outputVideoPath);
          logger.info(`Fallback to first clip due to list file error`, {
            service: "clip-service",
          });
          resolve(true);
        } else {
          resolve(false);
        }
        return;
      }

      // Use concat demuxer for faster concatenation without re-encoding
      const videoCommand = ffmpeg()
        .input(listFilePath)
        .inputOptions(["-f concat", "-safe 0"])
        .outputOptions([
          "-c copy", // Use stream copy for faster processing
          "-movflags +faststart",
          "-threads 0", // Use all available threads
        ])
        .output(outputVideoPath)
        .on("error", (err) => {
          logger.error(`Error concatenating video: ${err}`, {
            service: "clip-service",
          });

          // Try fallback with re-encoding if direct copy fails
          logger.info("Fallback to concatenation with re-encoding", {
            service: "clip-service",
          });
          ffmpeg()
            .input(listFilePath)
            .inputOptions(["-f concat", "-safe 0"])
            .outputOptions([
              "-c:v libx264",
              "-preset ultrafast",
              "-crf 28",
              "-c:a aac",
              "-b:a 128k",
              "-threads 0",
            ])
            .output(outputVideoPath)
            .on("error", (fallbackErr) => {
              logger.error(`Fallback concatenation failed: ${fallbackErr}`, {
                service: "clip-service",
              });
              if (clipPaths.length > 0) {
                logger.info("Using first clip as fallback", {
                  service: "clip-service",
                });
                try {
                  fs.copyFileSync(clipPaths[0], outputVideoPath);
                  resolve(true);
                } catch (copyErr) {
                  logger.error(`Error copying fallback clip: ${copyErr}`, {
                    service: "clip-service",
                  });
                  resolve(false);
                }
              } else {
                resolve(false);
              }
            })
            .on("end", finalizeAudio)
            .run();
        })
        .on("end", finalizeAudio)
        .run();

      // Function to create audio after video is done
      function finalizeAudio() {
        // Clean up the list file
        try {
          fs.unlinkSync(listFilePath);
        } catch (unlinkErr) {
          logger.warn(`Failed to delete concat list file: ${unlinkErr}`, {
            service: "clip-service",
          });
        }

        // Create audio file
        ffmpeg(outputVideoPath)
          .output(outputAudioPath)
          .outputOptions([
            "-vn",
            "-c:a libmp3lame",
            "-q:a 4", // Lower quality for faster encoding
            "-threads 0", // Use all available threads
          ])
          .on("error", (err) => {
            logger.error(`Error creating audio output: ${err}`, {
              service: "clip-service",
            });
            // Continue even if audio extraction fails
            resolve(true);
          })
          .on("end", () => {
            resolve(true);
          })
          .run();
      }
    } catch (err) {
      logger.error(`Exception in concatenateClips: ${err}`, {
        service: "clip-service",
      });

      // Fallback to first clip
      if (clipPaths.length > 0) {
        try {
          logger.info("Falling back to first clip due to exception", {
            service: "clip-service",
          });
          fs.copyFileSync(clipPaths[0], outputVideoPath);

          // Create audio from the first clip
          ffmpeg(clipPaths[0])
            .output(outputAudioPath)
            .outputOptions(["-vn", "-c:a libmp3lame", "-q:a 4", "-threads 0"])
            .on("error", (err) => {
              logger.error(`Error extracting audio in fallback: ${err}`, {
                service: "clip-service",
              });
              resolve(true);
            })
            .on("end", () => {
              resolve(true);
            })
            .run();
        } catch (copyErr) {
          logger.error(`Error in fallback copying: ${copyErr}`, {
            service: "clip-service",
          });
          resolve(false);
        }
      } else {
        resolve(false);
      }
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
  resultType: VideoResultType = "landscape"
): Promise<FinalClipResponse> {
  // Create temp directory for storing clip segments
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
