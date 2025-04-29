import { CoreMessage, generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { Clips, ClipsSchema } from "../schemas/clips";

export async function generateClips(
  promptMessages: CoreMessage[]
): Promise<Clips> {
  const { object } = await generateObject({
    model: openai("gpt-4.1-mini"),
    schema: ClipsSchema,
    messages: promptMessages,
  });

  return object.clips;
}
