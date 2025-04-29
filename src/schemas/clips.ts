import { z } from "zod";

export const ClipsSchema = z.object({
  clips: z.array(
    z.object({
      index: z
        .number()
        .describe(
          "Index of the video, indexing starts from 0, so the first video will be 0 and so on"
        ),
      start: z.number().describe("Start time of the clip in milliseconds"),
      end: z.number().describe("End time of the clip in milliseconds"),
      summary: z
        .string()
        .describe(
          "Analysis of the clip, why it stands out and have advertising potential"
        ),
    })
  ),
});

export type Clips = z.infer<typeof ClipsSchema>['clips'];
