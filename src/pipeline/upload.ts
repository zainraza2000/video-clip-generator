import { uploadFile } from "../services/s3Service";
import fs from "fs/promises";
import mime from "mime-types";
import path from "path";
import logger from "../utils/logger";

export async function uploadScreenshotsToCloud(screeshotPaths: string[]) {
  try {
    const urls = await Promise.all(
      screeshotPaths.map(async (screenshotPath) => {
        return await uploadFileByPath(screenshotPath);
      })
    );
    return urls;
  } catch (ex) {
    logger.error(JSON.stringify(ex), { service: "upload-service" });
    throw ex
  }
}

export async function uploadFileByPath(filePath: string){
  const buffer = await fs.readFile(filePath);
  const originalName = path.basename(filePath);
  const mimeType =
    mime.lookup(originalName) || "application/octet-stream";
  const url = await uploadFile({ buffer, originalName, mimeType });
  return url
}
