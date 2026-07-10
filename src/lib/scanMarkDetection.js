import jsQR from "jsqr";

// Decodes a QR code anywhere in the given canvas (the printed corner code, at whatever
// rotation the page was photographed at). Returns jsQR's raw result — { data, location } —
// or null when nothing was found. `location` gives the 4 corners of the detected code in
// photo-pixel coordinates, which doubles as a small local ruler (see mapOffsetToPhoto) so we
// don't need the operator to align/crop anything by hand.
export function decodeQrFromCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
}

// Printed pages aren't forced one-question-per-page, so a single photographed page can carry
// several questions' corner QR codes. jsQR only ever returns the first code it finds, so this
// decodes repeatedly, blotting out each found code's bounding box before the next pass, until
// nothing new turns up. That gives every question on the page its own accurately-located QR
// (and therefore its own local checkbox ruler — see mapOffsetToPhoto) instead of just one.
export function decodeAllQrCodes(canvas, maxCodes = 12) {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const results = [];
  for (let i = 0; i < maxCodes; i++) {
    const result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
    if (!result) break;
    results.push(result);
    const xs = [result.location.topLeftCorner.x, result.location.topRightCorner.x, result.location.bottomLeftCorner.x, result.location.bottomRightCorner.x];
    const ys = [result.location.topLeftCorner.y, result.location.topRightCorner.y, result.location.bottomLeftCorner.y, result.location.bottomRightCorner.y];
    const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 4);
    const x1 = Math.min(imageData.width - 1, Math.ceil(Math.max(...xs)) + 4);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 4);
    const y1 = Math.min(imageData.height - 1, Math.ceil(Math.max(...ys)) + 4);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const idx = (y * imageData.width + x) * 4;
        imageData.data[idx] = 128;
        imageData.data[idx + 1] = 128;
        imageData.data[idx + 2] = 128;
      }
    }
  }
  return results;
}

// Parses the compact scan-sort payload printed in each question's corner QR, e.g. "VS-PA-14-Q7".
export function parseScanSortPayload(text) {
  const match = String(text || "").trim().match(/^VS-([A-Z0-9]+)-(\d+)-Q(\d+)$/);
  if (!match) return null;
  return { testCode: match[1], candidateNumber: match[2], anchorQuestion: Number(match[3]) };
}

// A checkbox position is known only as a (dxMm, dyMm) offset from its own question's QR module
// grid — i.e. the part jsQR's `location` corners actually bound, which excludes the printed
// quiet-zone margin around it (see measureCandidateCheckboxLayout's moduleGridMm in App.jsx). To
// find that same checkbox in a photographed page, build a local ruler from the QR's own detected
// corners: however the page was rotated or tilted when the photo was taken, the QR was printed
// immediately above/beside its checkboxes, so this local basis stays accurate for that small a
// distance even though it says nothing about the rest of the page. `unitMm` is that question's
// module-grid size in mm (varies slightly with QR content length/version, so it's supplied per
// question rather than assumed).
export function mapOffsetToPhoto(qrLocation, dxMm, dyMm, unitMm) {
  const { topLeftCorner, topRightCorner, bottomLeftCorner } = qrLocation;
  const xVec = { x: (topRightCorner.x - topLeftCorner.x) / unitMm, y: (topRightCorner.y - topLeftCorner.y) / unitMm };
  const yVec = { x: (bottomLeftCorner.x - topLeftCorner.x) / unitMm, y: (bottomLeftCorner.y - topLeftCorner.y) / unitMm };
  return {
    x: topLeftCorner.x + xVec.x * dxMm + yVec.x * dyMm,
    y: topLeftCorner.y + xVec.y * dxMm + yVec.y * dyMm,
  };
}

// Fraction of pixels darker than a fixed threshold in a square region — the basic "how filled
// in does this look" measurement, reused both for whole-box marked/empty and for the finer
// diagonal-vs-off-diagonal sampling that tells a fill/checkmark apart from a cross-out.
export function sampleDarkness(imageData, cx, cy, halfSizePx) {
  const { data, width, height } = imageData;
  let dark = 0;
  let total = 0;
  const x0 = Math.max(0, Math.round(cx - halfSizePx));
  const x1 = Math.min(width - 1, Math.round(cx + halfSizePx));
  const y0 = Math.max(0, Math.round(cy - halfSizePx));
  const y1 = Math.min(height - 1, Math.round(cy + halfSizePx));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      total++;
      if (luminance < 140) dark++;
    }
  }
  return total ? dark / total : 0;
}

// Classifies one checkbox region: empty, a solid fill/checkmark ("marked"), or a diagonal
// cross-out ("crossedOut" — a candidate voiding their own mark, which VetBara treats as "not
// this option" rather than as a second answer). Uses a 5x5 sampling grid: a genuine mark tends
// to darken the box fairly evenly, while an X concentrates darkness along the two diagonals and
// leaves the off-diagonal corners comparatively light.
export function classifyMark(imageData, cx, cy, boxHalfSizePx) {
  const grid = 5;
  const cells = [];
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const px = cx - boxHalfSizePx + ((gx + 0.5) / grid) * boxHalfSizePx * 2;
      const py = cy - boxHalfSizePx + ((gy + 0.5) / grid) * boxHalfSizePx * 2;
      const d = sampleDarkness(imageData, px, py, boxHalfSizePx / grid);
      cells.push({ gx, gy, d });
    }
  }
  const overall = cells.reduce((sum, c) => sum + c.d, 0) / cells.length;
  if (overall < 0.15) return { marked: false, crossedOut: false, darkness: overall };
  const diag = cells.filter((c) => c.gx === c.gy || c.gx === grid - 1 - c.gy);
  const offDiag = cells.filter((c) => !(c.gx === c.gy || c.gx === grid - 1 - c.gy));
  const diagAvg = diag.reduce((sum, c) => sum + c.d, 0) / diag.length;
  const offDiagAvg = offDiag.length ? offDiag.reduce((sum, c) => sum + c.d, 0) / offDiag.length : 0;
  return { marked: true, crossedOut: diagAvg - offDiagAvg > 0.28, darkness: overall };
}

// Given every option's mark classification for one question, decides the final answer per the
// spec: a crossed-out box is a voided mark, not a candidate — exclude it first. If exactly one
// option remains marked, that's the answer. Zero means unanswered. Two or more still marked
// after excluding cross-outs is a genuine ambiguity the Centre/Examiner must resolve by eye.
export function resolveQuestionMark(optionResults) {
  const survivors = optionResults.filter((r) => r.marked && !r.crossedOut);
  if (survivors.length === 1) return { selectedIndex: survivors[0].index, error: false };
  if (survivors.length === 0) return { selectedIndex: null, error: false };
  return { selectedIndex: null, error: true };
}
