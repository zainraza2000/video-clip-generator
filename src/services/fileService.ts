import { unlink } from "fs/promises";

export async function deleteFiles(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await unlink(path);
      console.log(`Deleted: ${path}`);
    } catch (error) {
      console.error(`Failed to delete ${path}:`, error);
    }
  }
}
