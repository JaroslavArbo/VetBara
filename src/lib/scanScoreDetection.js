// Reading the mark the examiner wrote in the score box at the bottom right of a printed question.
//
// This is a best-effort *estimate* that pre-fills the marking window — never a substitute for the
// examiner looking at the page. Two things make it tractable despite being handwriting: the box is
// at a known offset from that question's corner QR, so the crop is exact; and the answer must be one
// of a handful of values (0 to the question's maximum, in half-point steps), so a recognised string
// only has to be close enough to snap onto the right one.

// Otsu's method: the box contains printed border, paper and ink, so a fixed threshold would fail on
// a dim phone photo. Returns the luminance cut that best separates the two populations.
function otsuThreshold(values) {
  const histogram = new Array(256).fill(0);
  values.forEach((value) => { histogram[value] += 1; });
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];
  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let bestVariance = -1;
  for (let i = 0; i < 256; i += 1) {
    weightB += histogram[i];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += i * histogram[i];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) ** 2;
    if (variance > bestVariance) { bestVariance = variance; best = i; }
  }
  return best;
}

// Crops the score box out of the photo and returns it as a binary ink mask. `insetRatio` drops the
// printed border of the box itself, which would otherwise dominate every connected-component pass.
export function cropScoreBox(imageData, centerX, centerY, halfWidth, halfHeight, insetRatio = 0.18) {
  const x0 = Math.max(0, Math.round(centerX - halfWidth * (1 - insetRatio)));
  const x1 = Math.min(imageData.width - 1, Math.round(centerX + halfWidth * (1 - insetRatio)));
  const y0 = Math.max(0, Math.round(centerY - halfHeight * (1 - insetRatio)));
  const y1 = Math.min(imageData.height - 1, Math.round(centerY + halfHeight * (1 - insetRatio)));
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  if (width < 6 || height < 6) return null;

  const luminance = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = ((y0 + y) * imageData.width + (x0 + x)) * 4;
      const value = (imageData.data[source] * 0.299 + imageData.data[source + 1] * 0.587 + imageData.data[source + 2] * 0.114) | 0;
      luminance[y * width + x] = value;
    }
  }
  const threshold = otsuThreshold(Array.from(luminance));
  const ink = new Uint8Array(width * height);
  let inkCount = 0;
  for (let i = 0; i < ink.length; i += 1) {
    if (luminance[i] < threshold) { ink[i] = 1; inkCount += 1; }
  }
  return { width, height, ink, inkCount };
}

// 4-connected components, so two digits that touch only diagonally still separate.
function connectedComponents(crop) {
  const { width, height, ink } = crop;
  const labels = new Int32Array(width * height).fill(-1);
  const components = [];
  const stack = [];
  for (let start = 0; start < ink.length; start += 1) {
    if (!ink[start] || labels[start] !== -1) continue;
    const id = components.length;
    const box = { minX: width, maxX: -1, minY: height, maxY: -1, pixels: [] };
    stack.push(start);
    labels[start] = id;
    while (stack.length) {
      const index = stack.pop();
      const x = index % width;
      const y = (index / width) | 0;
      box.pixels.push(index);
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
      const neighbours = [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1];
      neighbours.forEach((next) => {
        if (next >= 0 && ink[next] && labels[next] === -1) { labels[next] = id; stack.push(next); }
      });
    }
    components.push(box);
  }
  return components;
}

// Digits are compared as 8x8 occupancy grids, which throws away stroke thickness and pen wobble and
// keeps only the shape — the part that actually distinguishes a 3 from an 8.
const GRID = 8;
function componentGrid(crop, component) {
  const boxWidth = component.maxX - component.minX + 1;
  const boxHeight = component.maxY - component.minY + 1;
  const grid = new Float32Array(GRID * GRID);
  const counts = new Float32Array(GRID * GRID);
  component.pixels.forEach((index) => {
    const x = index % crop.width;
    const y = (index / crop.width) | 0;
    const gx = Math.min(GRID - 1, Math.floor(((x - component.minX) / boxWidth) * GRID));
    const gy = Math.min(GRID - 1, Math.floor(((y - component.minY) / boxHeight) * GRID));
    counts[gy * GRID + gx] += 1;
  });
  const peak = Math.max(...counts, 1);
  for (let i = 0; i < grid.length; i += 1) grid[i] = counts[i] / peak;
  return grid;
}

// Templates are rendered from the browser's own fonts rather than hardcoded, so the comparison set
// covers several letterforms instead of one person's idea of what a "4" looks like.
const TEMPLATE_FONTS = ["48px Arial", "48px Georgia", "bold 48px Arial"];
let templateCache = null;
function digitTemplates() {
  if (templateCache) return templateCache;
  if (typeof document === "undefined") return [];
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const templates = [];
  for (let digit = 0; digit <= 9; digit += 1) {
    TEMPLATE_FONTS.forEach((font) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = "#000";
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(digit), 32, 32);
      const image = ctx.getImageData(0, 0, 64, 64);
      const ink = new Uint8Array(64 * 64);
      for (let i = 0; i < ink.length; i += 1) ink[i] = image.data[i * 4] < 128 ? 1 : 0;
      const crop = { width: 64, height: 64, ink };
      const [component] = connectedComponents(crop).sort((a, b) => b.pixels.length - a.pixels.length);
      if (component) templates.push({ digit, grid: componentGrid(crop, component) });
    });
  }
  templateCache = templates;
  return templates;
}

function classifyDigit(grid) {
  let best = null;
  let bestDistance = Infinity;
  digitTemplates().forEach((template) => {
    let distance = 0;
    for (let i = 0; i < grid.length; i += 1) distance += (grid[i] - template.grid[i]) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = template.digit; }
  });
  // Normalised so a caller can compare across crops; 64 cells each at most 1 apart.
  return { digit: best, distance: bestDistance / grid.length };
}

// Every value the examiner is allowed to write for this question.
export function allowedScores(maxPoints) {
  const max = Number(maxPoints);
  if (!Number.isFinite(max) || max <= 0) return [];
  const values = [];
  for (let value = 0; value <= max + 1e-9; value += 0.5) values.push(Math.round(value * 2) / 2);
  return values;
}

// Reads whatever is in the crop and snaps it to the nearest legal mark. Returns null when the box
// looks empty or the reading is too poor to be worth pre-filling — a blank box is a better default
// than a confident wrong number.
export function recognizeScore(crop, maxPoints, { minInkRatio = 0.004, maxDistance = 0.09 } = {}) {
  if (!crop) return null;
  const allowed = allowedScores(maxPoints);
  if (!allowed.length) return null;
  if (crop.inkCount / (crop.width * crop.height) < minInkRatio) return null;

  const minPixels = Math.max(4, Math.round(crop.width * crop.height * 0.0012));
  // Deliberately no height filter here: a comma or full stop is small in every dimension, and
  // dropping it turned "2,5" into "25" — a reading far outside the allowed range, so the whole box
  // was discarded. Separators are identified below by where they sit, not by being big enough.
  const components = connectedComponents(crop)
    .filter((component) => component.pixels.length >= minPixels)
    .sort((a, b) => a.minX - b.minX);
  if (!components.length || components.length > 4) return null;

  const tallest = Math.max(...components.map((component) => component.maxY - component.minY + 1));
  let text = "";
  let worstDistance = 0;
  for (const component of components) {
    const height = component.maxY - component.minY + 1;
    // A comma, full stop or half-height tick sits low and small: treat it as the decimal separator
    // rather than trying to read it as a digit.
    const width = component.maxX - component.minX + 1;
    if (height < tallest * 0.6 && width < crop.width * 0.18 && component.maxY > crop.height * 0.5) { text += "."; continue; }
    const { digit, distance } = classifyDigit(componentGrid(crop, component));
    if (digit === null) return null;
    worstDistance = Math.max(worstDistance, distance);
    text += String(digit);
  }
  if (worstDistance > maxDistance) return null;

  const value = Number(text.replace(/\.$/, ".5"));
  if (!Number.isFinite(value)) return null;
  const snapped = allowed.reduce((best, option) => (Math.abs(option - value) < Math.abs(best - value) ? option : best), allowed[0]);
  // A reading that has to move more than a half point to become legal was not really a reading.
  if (Math.abs(snapped - value) > 0.5) return null;
  return { value: snapped, raw: text, confidence: Math.max(0, 1 - worstDistance / maxDistance) };
}
