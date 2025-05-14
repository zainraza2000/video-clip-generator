import { PromptType } from "../types";

export const DEFAULT_USER_PROMPT = "";
export const VIDEO_TAG_START = "<VIDEO>";
export const VIDEO_TAG_END = "</VIDEO>";
export const INDEX_TAG_START = "<INDEX>";
export const INDEX_TAG_END = "</INDEX>";
export const TRANSCRIPT_TAG_START = "<TRANSCRIPT>";
export const TRANSCRIPT_TAG_END = "</TRANSCRIPT>";
export const SCREENSHOT_TAG_START = "<SCREENSHOT>";
export const SCREENSHOT_TAG_END = "</SCREENSHOT>";
const defaultUserPrompt =
  "I have multiple video clips of my partner and me doing cheers with different beverages and desserts. Please extract a 2-second clip from each video capturing the exact moment our glasses or items touch together during the cheers";
const bothInstruction = (
  segmentInterval: number,
  screenshotsPerSegment: number
) =>
  `include both the transcript (dialogue, narration, or spoken words) and screenshots taken at ${
    Math.round((segmentInterval / screenshotsPerSegment) * 10) / 10
  }-second intervals. The transcript will include timestamps in milliseconds in the format [start_time -- end_time], followed by the corresponding spoken text. For example: [1360 -- 2184] -- B: I've got an idea for.\n[2192 - 11816] -- A: A Heinz ketchup commercial`;
const transcriptInstruction =
  "include the transcript (dialogue, narration, or spoken words). The transcript will include timestamps in milliseconds in the format [start_time -- end_time], followed by the corresponding spoken text. For example: [1360 -- 2184] -- B: I've got an idea for.\n[2192 - 11816] -- A: A Heinz ketchup commercial";
const screenshotInstruction = (
  segmentInterval: number,
  screenshotsPerSegment: number
) =>
  `include screenshots taken at ${
    Math.round((segmentInterval / screenshotsPerSegment) * 10) / 10
  }-second intervals`;

export function buildSystemPrompt(
  segmentInterval: number,
  screenshotsPerSegment: number,
  totalVideos: number,
  maxVideoLengthSeconds: number,
  userPrompt: string = defaultUserPrompt,
  type: PromptType
) {
  const systemPrompt = `You are a creative and analytical AI assistant that specializes in identifying engaging, high-impact moments from videos for use in social media content. You will identify those moments such that clips from different videos can be combined into a single piece of content.
You will receive a total of ${totalVideos} in segmented form. Each video is wrapped inside ${VIDEO_TAG_START} tags, with the index of the video inside the ${INDEX_TAG_START} tag. Each video consists of ${segmentInterval}-second segments that ${
    type === "both"
      ? bothInstruction(segmentInterval, screenshotsPerSegment)
      : type === "transcript"
      ? transcriptInstruction
      : screenshotInstruction(segmentInterval, screenshotsPerSegment)
  }.
Your task is to analyze each video individually and identify the most compelling "hooks" or interesting moments. These moments could include emotionally charged scenes, surprising dialogue, visually striking images, exciting transitions, or anything that could grab a viewer's attention. Focus on what would work well in a short-form promotional video — moments that are intriguing, dramatic, visually powerful, or curiosity-inducing.
For each video, return a structured list of clips. The total duration of all the selected clips should not exceed ${maxVideoLengthSeconds} seconds (${
    maxVideoLengthSeconds * 1000
  } milliseconds). Each clip you generate must contain the order in which the clip should be used in the final video (order 1 will be the first clip in the final content).If the combined duration exceeds this limit, prioritize the most engaging and impactful moments.
All video data to be analyzed will appear inside ${VIDEO_TAG_START} tags.${
    userPrompt &&
    ` Here are some specific instructions from the user, keep them in mind when deciding the clips: \n${userPrompt}\n`
  }
`;
  return systemPrompt;
}
