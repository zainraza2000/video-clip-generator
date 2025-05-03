import { Subtitle } from "../types";

export class SrtParser {
  /**
   * Parses SRT content into an array of Subtitle objects
   * @param srtContent The raw SRT file content as a string
   * @returns Array of parsed Subtitle objects
   */
  public parse(srtContent: string): Subtitle[] {
    // Split the content by double newlines to separate subtitle blocks
    const blocks = srtContent.trim().split(/\r?\n\r?\n/);

    return blocks.map((block) => {
      const lines = block.split(/\r?\n/);

      // First line is the ID
      const id = lines[0].trim();

      // Second line contains the timestamps
      const timestampMatch = lines[1].match(
        /(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/
      );
      if (!timestampMatch) {
        throw new Error(`Invalid timestamp format in subtitle ID ${id}`);
      }

      const startTime = timestampMatch[1];
      const endTime = timestampMatch[2];

      // Remaining lines form the text content
      const text = lines.slice(2).join("\n");

      // Convert timestamps to seconds
      const startSeconds = this.timeToSeconds(startTime);
      const endSeconds = this.timeToSeconds(endTime);

      return {
        id,
        startTime,
        startSeconds,
        endTime,
        endSeconds,
        text,
      };
    });
  }

  /**
   * Converts SRT timestamp (HH:MM:SS,mmm) to seconds
   * @param timestamp SRT format timestamp
   * @returns Time in seconds (float)
   */
  private timeToSeconds(timestamp: string): number {
    const parts = timestamp.split(",");
    const milliseconds = parseInt(parts[1]) / 1000;

    const timeParts = parts[0].split(":").map((part) => parseInt(part));
    const hours = timeParts[0];
    const minutes = timeParts[1];
    const seconds = timeParts[2];

    return hours * 3600 + minutes * 60 + seconds + milliseconds;
  }

}