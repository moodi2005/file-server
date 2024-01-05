import sharp from "sharp";
import fs from "fs";

// Function to compress an image
export const compressFun = (
  path: string,
  level: number,
  resize: boolean,
) => {
  let quality = 100;
  let size = 1500;

  // Adjust size based on compression level
  if (level < 5) size = 800;
  else if (level < 7) {
    size = 600;
  } else if (level < 8) size = 400;
  else size = 200;

  // Adjust quality based on compression level
  if (level > 3) quality = 80;

  // Read the image file
  fs.readFile(path, (err, data) => {
    if (err) throw err;

    // Compress the image using sharp library
    const image = sharp(data)
      .png({
        compressionLevel: level,
        quality,
        force: false,
        progressive: true,
      })
      .jpeg({ quality, force: false, progressive: true })
      .webp({ quality, force: false });

    // Resize the image if required
    if (resize) image.resize(size);

    // Save the compressed image to the same file path
    image.toFile(path);
  });
};
