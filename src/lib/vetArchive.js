import JSZip from "jszip";

// A ".vet" file comes in two shapes:
//   1. legacy: a plain JSON document, or
//   2. archive: a ZIP (magic bytes "PK") containing a manifest.json that points
//      at the real payload JSON via `payloadPath` (e.g. payload/package1.json).
// This reads whichever shape the file is and returns the parsed package object.
export async function readVetPackage(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"

  if (!isZip) {
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  const zip = await JSZip.loadAsync(buffer);

  const manifestEntry = zip.file("manifest.json");
  if (manifestEntry) {
    const manifest = JSON.parse(await manifestEntry.async("string"));
    const payloadEntry = manifest.payloadPath ? zip.file(manifest.payloadPath) : null;
    if (payloadEntry) {
      return JSON.parse(await payloadEntry.async("string"));
    }
  }

  // Fallback: first non-manifest .json file in the archive.
  const jsonName = Object.keys(zip.files).find(
    (name) => name.endsWith(".json") && name !== "manifest.json" && !zip.files[name].dir
  );
  if (jsonName) {
    return JSON.parse(await zip.file(jsonName).async("string"));
  }

  throw new Error("No package JSON found in the .vet archive");
}
