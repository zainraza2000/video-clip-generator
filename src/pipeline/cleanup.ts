import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";
import { TMP_DIR } from "../config";

export function cleanUpTmpDir(): void {
  try {
    if (!fs.existsSync(TMP_DIR)) {
      logger.info(`Temporary directory does not exist: ${TMP_DIR}`);
      return;
    }

    const files = fs.readdirSync(TMP_DIR);
    logger.info(`Cleaning up ${files.length} files in ${TMP_DIR}`);

    for (const file of files) {
      const filePath = path.join(TMP_DIR, file);
      try {
        fs.unlinkSync(filePath);
        logger.info(`Deleted file: ${filePath}`);
      } catch (err) {
        logger.error(`Failed to delete file: ${filePath}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to clean up temporary directory", {
      error: errorMessage,
    });
  }
}
