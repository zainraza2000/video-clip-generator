import { TranscriptUtterance } from "assemblyai";
import { PromptSegment, TranscriptInternal } from "../types";

export function utterancesToSentence(
  utterances: TranscriptUtterance[]
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
  screenshotsPerSegment: number,
): PromptSegment[] {
  const segments: PromptSegment[] = []
  console.log(screenshotPaths)
  transcriptSegments.forEach((transcriptSegment, index) => {
    const length = screenshotPaths.length
    const sliceStart = index * screenshotsPerSegment
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
  return segments
}

export async function preparePrompt() {

}
