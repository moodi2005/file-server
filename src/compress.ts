import sharp from "sharp";
import path from "path";

/**
 * Compresses an image file in-place using Sharp.
 * - Uses Sharp's native path input (no readFile buffer → lower RAM usage)
 * - resize is applied BEFORE format settings (correct Sharp pipeline order)
 * - Returns a Promise so callers can handle errors properly
 *
 * @param filePath  Absolute or relative path to the image file
 * @param level     Compression level 0–10 (higher = smaller file, lower quality)
 * @param resize    Whether to downscale the image based on level
 */
export const compressFun = async (
  filePath: string,
  level: number,
  resize: boolean
): Promise<void> => {
  // Map level → output size (higher level = more aggressive downsizing)
  let size = 1500;
  if (level >= 8)      size = 200;
  else if (level >= 7) size = 400;
  else if (level >= 5) size = 600;
  else                 size = 800;

  // Map level → quality (aggressive compression only above level 3)
  const quality = level > 3 ? 80 : 100;

  const ext = path.extname(filePath).substring(1).toLowerCase();

  // Build pipeline — Sharp accepts path directly, no readFile needed
  let pipeline = sharp(filePath);

  // resize MUST come before format settings in Sharp pipeline
  if (resize) {
    pipeline = pipeline.resize(size, size, {
      fit: "inside",           // preserve aspect ratio
      withoutEnlargement: true // never upscale
    });
  }

  // Apply format-specific compression settings
  switch (ext) {
    case "png":
      pipeline = pipeline.png({
        compressionLevel: Math.round(level),
        quality,
        progressive: true,
        force: true,
      });
      break;

    case "jpg":
    case "jpeg":
      pipeline = pipeline.jpeg({
        quality,
        progressive: true,
        force: true,
      });
      break;

    case "webp":
      pipeline = pipeline.webp({
        quality,
        force: true,
      });
      break;

    default:
      // Unsupported format — skip silently
      return;
  }

  // Write back to the same path (overwrite original)
  await pipeline.toFile(filePath);
};