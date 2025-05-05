// import * as fs from 'fs';
// import ffmpeg from 'fluent-ffmpeg';
// import { promisify } from 'util';

// // Promisify fs.exists for cleaner async usage
// const exists = promisify(fs.exists);

// /**
//  * Burns SRT subtitles into an MP4 video file with TikTok-style captions
//  * Uses fluent-ffmpeg with async/await for cleaner, more maintainable code
//  *
//  * @param inputVideoPath Path to the input MP4 video file
//  * @param subtitlePath Path to the SRT subtitle file
//  * @param outputVideoPath Path for the output video with burnt-in subtitles
//  * @returns Promise that resolves when the process is complete
//  */
// export async function burnCaptions(
//   inputVideoPath: string,
//   subtitlePath: string,
//   outputVideoPath: string
// ): Promise<void> {
//   // Ensure input files exist
//   if (!await exists(inputVideoPath)) {
//     throw new Error(`Input video file not found: ${inputVideoPath}`);
//   }

//   if (!await exists(subtitlePath)) {
//     throw new Error(`Subtitle file not found: ${subtitlePath}`);
//   }

//   // Define subtitle style (same as in original code)
//   const subtitleStyle = 'FontName=Arial,FontSize=28,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,BorderStyle=1,Outline=2,Shadow=0,Bold=1,Alignment=2,MarginV=30';

//   // Return a promise that resolves when processing is complete
//   return new Promise((resolve, reject) => {
//     // Create ffmpeg command
//     ffmpeg(inputVideoPath)
//       // Add subtitle filter
//       .videoFilter(`subtitles=${subtitlePath}:force_style='${subtitleStyle}'`)
//       // Configure video codec
//       .videoCodec('libx264')
//       .addOption('-preset', 'medium')
//       // Copy audio stream without re-encoding
//       .audioCodec('copy')
//       // Set output path
//       .output(outputVideoPath)
//       // Log ffmpeg process
//       .on('start', (commandLine) => {
//         console.log(`FFmpeg process started: ${commandLine}`);
//       })
//       .on('progress', (progress) => {
//         // Optional: log progress if desired
//         if (progress.percent) {
//           console.log(`Processing: ${Math.round(progress.percent)}% done`);
//         }
//       })
//       .on('error', (err) => {
//         reject(new Error(`FFmpeg error: ${err.message}`));
//       })
//       .on('end', () => {
//         resolve();
//       })
//       // Run the process
//       .run();
//   });
// }
import * as fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import { promisify } from "util";
import * as path from "path";
import { Subtitle } from "../types";
import { SrtParser } from "../services/srtParser";
import crypto from "crypto";
import logger from "../utils/logger";

// Promisify fs functions
const exists = promisify(fs.exists);
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

/**
 * Defines options for TikTok-style caption animations
 */
export interface TikTokCaptionOptions {
  // Font settings
  fontName?: string;
  fontSize?: number;
  fontColor?: string;
  outlineColor?: string;
  outlineWidth?: number;

  // Growth animation settings
  startScale?: number;
  endScale?: number;

  // Line width for automatic line breaking
  lineWidth?: number;

  // Text effects
  bold?: boolean;
  animationDuration?: number;
  
  // Video dimensions (will be auto-detected if not provided)
  videoWidth?: number;
  videoHeight?: number;
}

/**
 * Default options for TikTok-style captions
 */
const defaultOptions: TikTokCaptionOptions = {
  fontName: "Arial",
  fontSize: 40,
  fontColor: "FFFFFF",
  outlineColor: "000000",
  outlineWidth: 2,
  startScale: 30,
  endScale: 100,
  animationDuration: 1000,
  lineWidth: 30,
  bold: true,
};

/**
 * Gets video dimensions using ffmpeg
 * @param videoPath Path to the video file
 * @returns Promise with video width and height
 */
function getVideoDimensions(videoPath: string): Promise<{width: number, height: number}> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      
      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      if (!videoStream) {
        reject(new Error('No video stream found'));
        return;
      }
      
      resolve({
        width: videoStream.width || 1280,
        height: videoStream.height || 720
      });
    });
  });
}

/**
 * Converts SRT file to ASS format with TikTok-style animations
 * @param srtContent Content of the SRT file
 * @param options Caption styling and animation options
 * @returns Path to the generated ASS file
 */
async function convertSrtToAnimatedAss(
  srtContent: string,
  options: TikTokCaptionOptions = {}
): Promise<string> {
  // Merge with default options
  const opts = { ...defaultOptions, ...options };

  const srtParser = new SrtParser();
  const subtitles = srtParser.parse(srtContent);

  // Create ASS file content with animations
  const assContent = generateAnimatedAss(subtitles, opts);

  // Create temp directory if it doesn't exist
  const tempDir = path.join(process.cwd(), "tmp");
  if (!(await exists(tempDir))) {
    await mkdir(tempDir);
  }

  // Write ASS file
  const assFilePath = path.join(
    tempDir,
    `${crypto.randomBytes(32).toString("hex")}.ass`
  );
  await writeFile(assFilePath, assContent, "utf8");

  return assFilePath;
}

/**
 * Converts SRT timestamp to ASS timestamp format
 */
function convertTimeFormat(srtTime: string): string {
  const parts = srtTime.split(",");
  const timePart = parts[0].replace(/^0/, "");
  const millisecondsPart = parts[1].substring(0, 2);

  return `${timePart}.${millisecondsPart}`;
}

/**
 * Generates ASS file content with TikTok-style animations
 */
function generateAnimatedAss(
  subtitles: Subtitle[],
  options: TikTokCaptionOptions
): string {
  // Determine if it's portrait or landscape mode based on dimensions
  const isPortrait = (options.videoHeight || 720) > (options.videoWidth || 1280);
  
  // Set appropriate PlayResX and PlayResY based on video orientation
  const playResX = options.videoWidth || 1280;
  const playResY = options.videoHeight || 720;
  
  // Calculate the base font size
  // For portrait videos, we want to scale relative to width, but keep it larger
  let fontSize = options.fontSize || 40;
  
  if (isPortrait) {
    // For portrait, use a percentage of video width for font size
    // This ensures better readability on narrow videos
    const portraitFontSizePercentage = 0.08; // 8% of video width
    fontSize = Math.max(
      Math.round(playResX * portraitFontSizePercentage), 
      30  // Minimum font size of 30
    );
  }
  
  // Calculate line width - how many characters per line
  // For portrait, we want fewer characters per line
  let lineWidth = options.lineWidth || 30;
  if (isPortrait) {
    // Use approximately 60% of the standard line width for portrait
    lineWidth = Math.min(
      Math.round(lineWidth * 0.6),
      Math.floor(playResX / (fontSize * 0.6))  // Estimate chars that fit width
    );
    // Ensure a minimum reasonable line width
    lineWidth = Math.max(15, lineWidth);
  }
  
  // Determine bottom margin based on orientation
  // For portrait videos, position captions higher from bottom (TikTok style)
  const marginV = isPortrait ? Math.round(playResY * 0.15) : 30; // 15% from bottom in portrait
  
  // For portrait videos, increase outline width slightly for better visibility
  const outlineWidth = isPortrait ? (options.outlineWidth || 2) + 0.5 : (options.outlineWidth || 2);

  // Build ASS header with dynamic dimensions
  let assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TikTok,${options.fontName},${fontSize},&H00${
    options.fontColor
  },&H000000FF,&H00${options.outlineColor},&H00000000,${
    options.bold ? "-1" : "0"
  },0,0,0,100,100,0,0,1,${outlineWidth},0,2,20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Add dialogue lines with grow animation and text wrapping
  subtitles.forEach((sub) => {
    const startTime = convertTimeFormat(sub.startTime);
    const endTime = convertTimeFormat(sub.endTime);

    // Apply text wrapping with adjusted line width
    const wrappedText = wrapText(sub.text, lineWidth);

    // Apply grow animation
    const animatedText = applyGrowAnimation(wrappedText, options);

    // Add dialogue line with animation
    assContent += `Dialogue: 0,${startTime},${endTime},TikTok,,0,0,0,,${animatedText}\n`;
  });

  return assContent;
}

/**
 * Wraps text to fit within a specified character width
 */
function wrapText(text: string, lineWidth: number): string {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  words.forEach((word) => {
    if ((currentLine + " " + word).length > lineWidth && currentLine !== "") {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine === "" ? word : currentLine + " " + word;
    }
  });

  if (currentLine !== "") {
    lines.push(currentLine);
  }

  return lines.join("\\N");
}

/**
 * Applies a growing animation to the subtitle text
 */
function applyGrowAnimation(
  text: string,
  options: TikTokCaptionOptions
): string {
  const animDuration = options.animationDuration || 200;
  const startScale = options.startScale || 10;
  const animDurationCs = animDuration / 10;

  const transformTags = `\\fscx${startScale}\\fscy${startScale}\\t(0,${animDurationCs},\\fscx100\\fscy100)`;

  // Center alignment at the bottom
  const alignmentTag = "\\an2";

  return `{${alignmentTag}${transformTags}}${text}`;
}

/**
 * Burns animated captions into a video file with TikTok-style effects
 */
export async function burnTikTokCaptions(
  inputVideoPath: string,
  srtContent: string,
  outputVideoPath: string,
  options: TikTokCaptionOptions = {}
): Promise<void> {
  try {
    // Ensure input file exists
    if (!(await exists(inputVideoPath))) {
      throw new Error(`Input video file not found: ${inputVideoPath}`);
    }

    // Detect video dimensions
    const dimensions = await getVideoDimensions(inputVideoPath);
    console.log(`Video dimensions: ${dimensions.width}x${dimensions.height}`);
    
    // Add dimensions to options
    const enhancedOptions: TikTokCaptionOptions = {
      ...options,
      videoWidth: dimensions.width,
      videoHeight: dimensions.height
    };

    // Convert SRT to ASS with animations
    const assFilePath = await convertSrtToAnimatedAss(srtContent, enhancedOptions);

    // Return a promise that resolves when processing is complete
    return new Promise((resolve, reject) => {
      ffmpeg(inputVideoPath)
        .videoFilter(`ass=${assFilePath}`)
        .videoCodec("libx264")
        .addOption("-preset", "medium")
        .audioCodec("copy")
        .output(outputVideoPath)
        .on("start", (commandLine) => {
          console.log(`FFmpeg process started: ${commandLine}`);
        })
        .on("progress", (progress) => {
          if (progress.percent) {
            console.log(`Processing: ${Math.round(progress.percent)}% done`);
          }
        })
        .on("error", (err) => {
          reject(new Error(`FFmpeg error: ${err.message}`));
        })
        .on("end", () => {
          fs.unlink(assFilePath, () => {});
          resolve();
        })
        .run();
    });
  } catch (ex) {
    logger.error(JSON.stringify(ex), { service: "caption-service" });
    throw ex; // Re-throw to allow caller to handle the error
  }
}

export async function burnCaptions(
  inputVideoPath: string,
  srtContent: string,
  outputVideoPath: string
): Promise<void> {
  return burnTikTokCaptions(inputVideoPath, srtContent, outputVideoPath);
}