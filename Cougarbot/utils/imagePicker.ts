// Cougarbot/utils/imagePicker.ts
import * as ImagePicker from "expo-image-picker";
import type { ImagePickerAsset } from "expo-image-picker";


const MAX_IMAGE_BYTES = 4_000_000; // 4MB safe cap for base64 uploads

/**
 * Launches the image library picker and returns selected assets with base64 included.
 * NOTE: base64: true is required for getPickerAssetDataUri(s).
 */
export async function pickImagesBase64(): Promise<ImagePickerAsset[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: true,
    base64: true,
    quality: 0.9,
    exif: false,
  });

  if (result.canceled) return [];
  return result.assets ?? [];
}

/**
 * Converts a single picker asset into a data: URI.
 * Throws if base64 is missing or if image exceeds MAX_IMAGE_BYTES.
 */
export function getPickerAssetDataUri(asset: ImagePickerAsset): string {
  if (!asset?.base64) {
    throw new Error(
      "Picker asset is missing base64. Ensure launchImageLibraryAsync({ base64: true })."
    );
  }

  // approx bytes = len * 3/4
  const approxBytes = Math.floor((asset.base64.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    throw new Error("Image too large. Please choose a smaller/compressed image.");
  }

  const mime = asset.mimeType ?? guessMimeTypeFromUri(asset.uri) ?? "image/jpeg";
  return `data:${mime};base64,${asset.base64}`;
}

/**
 * Converts multiple picker assets into data: URIs.
 */
export function getPickerAssetDataUris(assets: ImagePickerAsset[]): string[] {
  return (assets ?? []).map(getPickerAssetDataUri);
}

function guessMimeTypeFromUri(uri: string): string | null {
  const lower = (uri ?? "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heic";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return null;
}
