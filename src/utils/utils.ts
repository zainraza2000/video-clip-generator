import { PipelineResponse } from "../types";
import logger from "./logger";

export function unwrapResponse<T>(res: PipelineResponse<T>): T | undefined {
  if (res.status === "error") {
    logger.error(res.message);
    return undefined;
  }

  return res.data;
}

export function errorResponse(message: string = "Unknown error"): {
  status: "error";
  message: string;
} {
  return { status: "error", message };
}
