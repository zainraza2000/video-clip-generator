import { PromptSegment, TranscriptInternal, UtteranceInternal } from "../types";
import { CoreMessage, ImagePart } from "ai";
import {
  buildSystemPrompt,
  VIDEO_TAG_END,
  VIDEO_TAG_START,
} from "../utils/prompt";
import { TRANSCRIPTION_SEGMENT_INTERVAL } from "../config";

export function utterancesToSentence(
  utterances: UtteranceInternal[]
): string {
  return utterances
    .map(
      (utterance) =>
        `[${utterance.start} - ${utterance.end}] -- ${utterance.speaker}: ${utterance.text}`
    )
    .join("\n");
}

export function getPrompSegments(
  transcriptSegments: TranscriptInternal[],
  screenshotPaths: string[],
  screenshotsPerSegment: number
): PromptSegment[] {
  const segments: PromptSegment[] = [];
  transcriptSegments.forEach((transcriptSegment, index) => {
    const length = screenshotPaths.length;
    const sliceStart = index * screenshotsPerSegment;
    const sliceEnd =
      sliceStart + screenshotsPerSegment > length
        ? length
        : sliceStart + screenshotsPerSegment;
    const screenshots = screenshotPaths.slice(sliceStart, sliceEnd);
    segments.push({
      text: utterancesToSentence(transcriptSegment.utterances),
      images: screenshots,
    });
  });
  return segments;
}

export function preparePromptMessages(
  prompSegmentsForVideos: PromptSegment[][],
  maxVideoLengthSeconds: number = 60,
  userPrompt?: string
): CoreMessage[] {
  const messages: CoreMessage[] = [];
  messages.push({
    role: "system",
    content: `${buildSystemPrompt(
      TRANSCRIPTION_SEGMENT_INTERVAL,
      prompSegmentsForVideos.length,
      maxVideoLengthSeconds,
      userPrompt
    )}`,
  });
  prompSegmentsForVideos.forEach((promptSegments) => {
    messages.push({ role: "user", content: `${VIDEO_TAG_START}` });
    promptSegments.forEach((segment) => {
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: `${segment.text}\n`,
          },
          ...segment.images.map(
            (image) => ({ type: "image", image } as ImagePart)
          ),
        ],
      });
    });
    messages.push({ role: "user", content: `\n${VIDEO_TAG_END}` });
  });
  return messages;
}
