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

// Promisify fs.exists for cleaner async usage
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
  startScale?: number; // Starting scale percentage (e.g., 50 = 50%)
  endScale?: number; // Ending scale percentage (e.g., 100 = 100%)

  // Line width for automatic line breaking
  lineWidth?: number; // Max width in characters per line

  // Text effects
  bold?: boolean;
  animationDuration?: number;
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
  startScale: 30, // Start at 30% of normal size
  endScale: 100, // End at 100% (normal size)
  animationDuration: 1000, // Growth animation lasts 1000ms
  lineWidth: 30, // Max 30 characters per line
  bold: true,
};

/**
 * Converts SRT file to ASS format with TikTok-style animations
 *
 * @param srtFilePath Path to the input SRT subtitle file
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
  // SRT format: 00:00:00,000
  // ASS format: 0:00:00.00
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
  // Build ASS header
  let assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TikTok,${options.fontName},${options.fontSize},&H00${
    options.fontColor
  },&H000000FF,&H00${options.outlineColor},&H00000000,${
    options.bold ? "-1" : "0"
  },0,0,0,100,100,0,0,1,${options.outlineWidth},0,2,20,20,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Add dialogue lines with grow animation and text wrapping
  subtitles.forEach((sub) => {
    const startTime = convertTimeFormat(sub.startTime);
    const endTime = convertTimeFormat(sub.endTime);

    // Apply text wrapping
    const wrappedText = wrapText(sub.text, options.lineWidth || 25);

    // Apply grow animation (bottom-centered text that grows from small to normal)
    const animatedText = applyGrowAnimation(wrappedText, options);

    // Add dialogue line with animation (bottom-center alignment is handled with \an2)
    assContent += `Dialogue: 0,${startTime},${endTime},TikTok,,0,0,0,,${animatedText}\n`;
  });

  return assContent;
}

/**
 * Wraps text to fit within a specified character width
 *
 * @param text Text to wrap
 * @param lineWidth Maximum characters per line
 * @returns Text with line breaks inserted
 */
function wrapText(text: string, lineWidth: number): string {
  // Split into words
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  // Process each word
  words.forEach((word) => {
    // If adding this word would exceed line width
    if ((currentLine + " " + word).length > lineWidth && currentLine !== "") {
      lines.push(currentLine);
      currentLine = word;
    } else {
      // Add word to current line (with space if not first word)
      currentLine = currentLine === "" ? word : currentLine + " " + word;
    }
  });

  // Add the last line if not empty
  if (currentLine !== "") {
    lines.push(currentLine);
  }

  // Join lines with ASS line break tag
  return lines.join("\\N");
}

/**
 * Applies a growing animation to the subtitle text
 * Creates an effect where text starts small and grows to normal size
 *
 * @param text Text to animate
 * @param options Animation options
 * @returns Text with ASS animation tags
 */
function applyGrowAnimation(
  text: string,
  options: TikTokCaptionOptions
): string {
  // Default animation duration if not specified (200ms)
  const animDuration = options.animationDuration || 200;
  const startScale = options.startScale || 10;
  // Calculate the time for transform in ASS centiseconds (1/100 of a second)
  const animDurationCs = animDuration / 10;

  // Start with a scale of 10% (0.1) and grow to 100% (1.0)
  // \t(start_time, end_time, \style_tag_initial, \style_tag_final)
  // We use \fscx and \fscy for scaling the text horizontally and vertically
  const transformTags = `\\fscx${startScale}\\fscy${startScale}\\t(0,${animDurationCs},\\fscx100\\fscy100)`;

  // Center alignment at the bottom
  const alignmentTag = "\\an2";

  // Combine all tags with the text
  return `{${alignmentTag}${transformTags}}${text}`;
}

/**
 * Burns animated captions into an MP4 video file with TikTok-style effects
 *
 * @param inputVideoPath Path to the input MP4 video file
 * @param subtitlePath Path to the SRT subtitle file
 * @param outputVideoPath Path for the output video with burnt-in subtitles
 * @param options Optional caption styling and animation options
 * @returns Promise that resolves when the process is complete
 */
export async function burnTikTokCaptions(
  inputVideoPath: string,
  srtContent: string,
  outputVideoPath: string,
  options: TikTokCaptionOptions = {}
): Promise<void> {
  try {
    // Ensure input files exist
    if (!(await exists(inputVideoPath))) {
      throw new Error(`Input video file not found: ${inputVideoPath}`);
    }

    // Convert SRT to ASS with animations
    const assFilePath = await convertSrtToAnimatedAss(srtContent, options);

    // Return a promise that resolves when processing is complete
    return new Promise((resolve, reject) => {
      // Create ffmpeg command
      ffmpeg(inputVideoPath)
        // Add ASS subtitle filter - without the problematic ignore_loop option
        .videoFilter(`ass=${assFilePath}`)
        // Configure video codec
        .videoCodec("libx264")
        .addOption("-preset", "medium")
        // Copy audio stream without re-encoding
        .audioCodec("copy")
        // Set output path
        .output(outputVideoPath)
        // Log ffmpeg process
        .on("start", (commandLine) => {
          console.log(`FFmpeg process started: ${commandLine}`);
        })
        .on("progress", (progress) => {
          // Optional: log progress if desired
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
        // Run the process
        .run();
    });
  } catch (ex) {
    logger.error(JSON.stringify(ex), { service: "caption-service" });
  }
}

export async function burnCaptions(
  inputVideoPath: string,
  srtContent: string,
  outputVideoPath: string
): Promise<void> {
  return burnTikTokCaptions(inputVideoPath, srtContent, outputVideoPath);
}
