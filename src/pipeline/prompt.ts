import { PromptSegment, PromptType, TranscriptInternal, UtteranceInternal } from "../types";
import { CoreMessage, ImagePart } from "ai";
import {
  buildSystemPrompt,
  INDEX_TAG_END,
  INDEX_TAG_START,
  VIDEO_TAG_END,
  VIDEO_TAG_START,
} from "../utils/prompt";
import { SCREENSHOTS_PER_SEGMENT, TRANSCRIPTION_SEGMENT_INTERVAL } from "../config";

export function utterancesToSentence(
  utterances: UtteranceInternal[]
): string {
  return utterances
    .map(
      (utterance) =>
        `[${utterance.start} - ${utterance.end}] -- ${utterance?.speaker || "NARRATOR"}: ${utterance.text}`
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
    const screenshots =
      sliceEnd === 0 ? [] : screenshotPaths.slice(sliceStart, sliceEnd);
    segments.push({
      text: utterancesToSentence(transcriptSegment.utterances),
      images: screenshots,
    });
  });
  return segments;
}

export function preparePromptMessages(
  prompSegmentsForVideos: PromptSegment[][],
  segmentInterval: number,
  screenshotsPerSegment: number,
  type: PromptType,
  maxVideoLengthSeconds: number = 60,
  userPrompt?: string
): CoreMessage[] {
  const messages: CoreMessage[] = [];
  messages.push({
    role: "system",
    content: `${buildSystemPrompt(
      segmentInterval,
      screenshotsPerSegment,
      prompSegmentsForVideos.length,
      maxVideoLengthSeconds,
      userPrompt,
      type
    )}`,
  });
  prompSegmentsForVideos.forEach((promptSegments, index) => {
    messages.push({
      role: "user",
      content: `${VIDEO_TAG_START}\n${INDEX_TAG_START}${index}${INDEX_TAG_END}`,
    });
    promptSegments.forEach((segment) => {
      messages.push({
        role: "user",
        content: [
          ...(segment.text
            ? [
                {
                  type: "text" as const,
                  text: `${segment.text}\n`,
                },
              ]
            : []),
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
