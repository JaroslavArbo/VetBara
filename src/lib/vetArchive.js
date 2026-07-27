import JSZip from "jszip";

// A ".vet" file comes in two shapes:
//   1. legacy: a plain JSON document, or
//   2. archive: a ZIP (magic bytes "PK") containing a manifest.json that points
//      at the real payload JSON via `payloadPath` (e.g. payload/package1.json).
// This reads whichever shape the file is and returns the parsed package object.
//
// Errors carry a `.code` so callers can show a localized, actionable message. The most
// common real-world failure is not a bad package but an unreadable one: a OneDrive/iCloud
// "online-only" file that the browser hands over empty or cannot read at all.
export async function readVetPackage(file) {
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (error) {
    throw vetError("unreadable", `The file could not be read from disk (${error?.message || error}).`);
  }

  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) {
    throw vetError("empty", "The selected file is empty (0 bytes).");
  }

  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"

  if (!isZip) {
    return parseJsonBytes(bytes, "unnamed .vet");
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    throw vetError("badzip", `The .vet archive could not be opened — it may be corrupted or only partially downloaded (${error?.message || error}).`);
  }

  const manifestEntry = zip.file("manifest.json");
  if (manifestEntry) {
    const manifest = parseJsonBytes(await manifestEntry.async("uint8array"), "manifest.json");
    const payloadEntry = manifest.payloadPath ? zip.file(manifest.payloadPath) : null;
    if (payloadEntry) {
      return parseJsonBytes(await payloadEntry.async("uint8array"), manifest.payloadPath);
    }
  }

  // Fallback: first non-manifest .json file in the archive.
  const jsonName = Object.keys(zip.files).find(
    (name) => name.endsWith(".json") && name !== "manifest.json" && !zip.files[name].dir
  );
  if (jsonName) {
    return parseJsonBytes(await zip.file(jsonName).async("uint8array"), jsonName);
  }

  throw vetError("nopackage", "No package JSON found in the .vet archive.");
}

function parseJsonBytes(bytes, label) {
  let text = new TextDecoder("utf-8").decode(bytes);
  // Strip a UTF-8 BOM if present — JSON.parse rejects a leading U+FEFF.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw vetError("badjson", `${label} is not valid JSON (${error?.message || error}).`);
  }
}

function vetError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
