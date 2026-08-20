import { access } from "node:fs/promises";
import { isAbsolute, resolve, win32 } from "node:path";

export type ResolvedDatasetFile = {
  absolutePath: string;
  displayPath: string;
  fileName: string;
};

export async function resolveDatasetFile(
  fileName: string,
  options: {
    repositoryRoot?: string;
    fileExists?: (path: string) => Promise<boolean>;
  } = {},
): Promise<ResolvedDatasetFile> {
  const requested = fileName.trim();
  if (
    !requested
    || requested === "."
    || requested === ".."
    || isAbsolute(requested)
    || win32.isAbsolute(requested)
    || /^[A-Za-z]:/.test(requested)
    || requested.includes("/")
    || requested.includes("\\")
  ) {
    throw new Error("Dataset argument must be a file name located directly inside data/.");
  }

  const displayPath = `data/${requested}`;
  const absolutePath = resolve(options.repositoryRoot ?? process.cwd(), "data", requested);
  const fileExists = options.fileExists ?? (async (path: string) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  });
  if (!await fileExists(absolutePath)) {
    throw new Error(`File not found: ${displayPath}\nPlace the CSV file in the repository's data/ directory and try again.`);
  }
  return { absolutePath, displayPath, fileName: requested };
}
