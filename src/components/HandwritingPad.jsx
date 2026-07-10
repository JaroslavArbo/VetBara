import { useRef, useState } from "react";
import { getStroke } from "perfect-freehand";

function tr(t, key, fallback) {
  return typeof t === "function" ? t(key) : fallback;
}

// Canonical helper from the perfect-freehand docs: turns the polygon points getStroke()
// returns into a smooth SVG path (quadratic curve through each point's midpoint).
function getSvgPathFromStroke(points) {
  if (!points.length) return "";
  const d = points.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...points[0], "Q"]
  );
  d.push("Z");
  return d.join(" ");
}

const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 900;
const ERASER_RADIUS = 16;
const STROKE_OPTIONS = { thinning: 0.6, smoothing: 0.5, streamline: 0.5 };

const COLORS = [
  { key: "black", value: "#0f172a" },
  { key: "red", value: "#dc2626" },
  { key: "blue", value: "#2563eb" },
  { key: "green", value: "#16a34a" },
];

const SIZES = [
  { key: "thin", value: 3 },
  { key: "medium", value: 7 },
  { key: "thick", value: 14 },
];

function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function strokeHitTest(stroke, point, threshold) {
  const pts = stroke.points;
  const radius = threshold + stroke.size / 2;
  if (pts.length === 1) return Math.hypot(point[0] - pts[0][0], point[1] - pts[0][1]) <= radius;
  for (let i = 0; i < pts.length - 1; i += 1) {
    if (distanceToSegment(point, pts[i], pts[i + 1]) <= radius) return true;
  }
  return false;
}

// Shared handwriting/sketch tool for stylus input, used both by the Candidate's field
// report notes and the Examiner's outdoor scoring notes. Pen-only (see pointerType checks)
// so resting a hand on the tablet while writing doesn't add stray marks. Strokes are kept as
// vector point data (not baked into the canvas immediately) so color/thickness/eraser/undo
// all just add or remove entries from `strokes` — the visible ink is only ever a re-render.
export function HandwritingPad({ onClose, onSave, title, helperText, existingImage, t, Button, CloseIcon, EraserIcon, UndoIcon }) {
  const svgRef = useRef(null);
  const drawingRef = useRef(false);
  // Tracks which single pointer (by id) is currently drawing, and whether it was a genuine
  // pen. Real palm rejection needs this instead of a blanket "pointerType !== pen -> ignore":
  // plenty of real styluses (especially on Android/Chrome, and some Bluetooth/EMR pens) never
  // report pointerType "pen" at all, so a hard pen-only gate silently drops every event from
  // them — the event then falls through unconsumed and the browser pans/scrolls the page
  // instead of drawing, which is exactly the "draws one dot, then the window just moves" bug.
  // Instead: accept whichever pointer starts a stroke first (pen, touch, or mouse), always
  // consume its events so the page can never take over, and only reject a *second* pointer
  // that shows up while the first one is still down (that's the actual palm-while-writing case).
  const activePointerIdRef = useRef(null);
  const [strokes, setStrokes] = useState([]);
  const [currentPoints, setCurrentPoints] = useState(null);
  const [color, setColor] = useState(COLORS[0].value);
  const [size, setSize] = useState(SIZES[1].value);
  const [eraserMode, setEraserMode] = useState(false);

  function svgPoint(event) {
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    // The <svg> keeps its default preserveAspectRatio ("xMidYMid meet"), so unless the
    // element's on-screen box happens to have exactly the CANVAS_WIDTH:CANVAS_HEIGHT ratio,
    // the viewBox content is letterboxed (centered, with blank padding on two sides) inside
    // that box. Mapping clientX/Y linearly against the full bounding rect — ignoring that
    // padding — is what made the ink drift away from the actual stylus tip as you drew
    // further from the center. Reproduce the same "meet" fit here so the two agree exactly.
    const viewBoxAspect = CANVAS_WIDTH / CANVAS_HEIGHT;
    const rectAspect = rect.width / rect.height;
    let renderWidth = rect.width;
    let renderHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;
    if (rectAspect > viewBoxAspect) {
      renderWidth = rect.height * viewBoxAspect;
      offsetX = (rect.width - renderWidth) / 2;
    } else {
      renderHeight = rect.width / viewBoxAspect;
      offsetY = (rect.height - renderHeight) / 2;
    }
    const x = ((event.clientX - rect.left - offsetX) / renderWidth) * CANVAS_WIDTH;
    const y = ((event.clientY - rect.top - offsetY) / renderHeight) * CANVAS_HEIGHT;
    const pressure = event.pressure > 0 ? event.pressure : 0.5;
    return [x, y, pressure];
  }

  function eraseAt(point) {
    setStrokes((prev) => prev.filter((stroke) => !strokeHitTest(stroke, point, ERASER_RADIUS)));
  }

  function handlePointerDown(event) {
    // A second pointer arriving while the first is still drawing is the real palm-rejection
    // case (e.g. a hand resting on the tablet while the stylus is down) — ignore it, but don't
    // preventDefault it either, so it doesn't interfere with the pointer that's already active.
    if (drawingRef.current && activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    // Pointer capture can fail (e.g. the pointer id isn't recognized as active) on some
    // browser/input combinations; that must not stop the stroke from being drawn, it just
    // means a move that leaves the SVG bounds won't keep tracking until pointerup.
    try { svgRef.current?.setPointerCapture?.(event.pointerId); } catch { /* not fatal */ }
    drawingRef.current = true;
    activePointerIdRef.current = event.pointerId;
    const point = svgPoint(event);
    if (eraserMode) eraseAt(point);
    else setCurrentPoints([point]);
  }

  function handlePointerMove(event) {
    if (!drawingRef.current || event.pointerId !== activePointerIdRef.current) return;
    event.preventDefault();
    const point = svgPoint(event);
    if (eraserMode) eraseAt(point);
    else setCurrentPoints((prev) => (prev ? [...prev, point] : [point]));
  }

  function handlePointerUp(event) {
    if (event.pointerId !== activePointerIdRef.current) return;
    drawingRef.current = false;
    activePointerIdRef.current = null;
    try { svgRef.current?.releasePointerCapture?.(event.pointerId); } catch { /* not fatal */ }
    if (!eraserMode && currentPoints && currentPoints.length > 1) {
      setStrokes((prev) => [...prev, { points: currentPoints, color, size }]);
    }
    setCurrentPoints(null);
  }

  function undo() {
    setStrokes((prev) => prev.slice(0, -1));
  }

  function clearAll() {
    setStrokes([]);
  }

  function pathFor(strokeData) {
    return getSvgPathFromStroke(getStroke(strokeData.points, { ...STROKE_OPTIONS, size: strokeData.size }));
  }

  async function handleSave() {
    const svg = svgRef.current;
    // Strip the background <image> (existingImage, if any) from the serialized SVG before
    // rasterizing it — it's drawn separately onto the canvas below via drawImage, using the
    // original data URL directly, so it doesn't need a second network/decode round trip through
    // an SVG <image> element (which can also be blocked by canvas tainting in some browsers).
    const svgClone = svg.cloneNode(true);
    const bg = svgClone.querySelector("[data-handwriting-bg]");
    if (bg) bg.remove();
    const svgString = new XMLSerializer().serializeToString(svgClone);
    const svgUrl = URL.createObjectURL(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const [background, strokesImage] = await Promise.all([
        existingImage
          ? new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = reject;
              img.src = existingImage;
            })
          : Promise.resolve(null),
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = svgUrl;
        }),
      ]);
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      if (background) ctx.drawImage(background, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.drawImage(strokesImage, 0, 0);
      onSave(canvas.toDataURL("image/png"));
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  }

  const currentPath = currentPoints && currentPoints.length > 1 ? getSvgPathFromStroke(getStroke(currentPoints, { ...STROKE_OPTIONS, size })) : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="flex max-h-[95vh] w-full max-w-4xl flex-col overflow-auto rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            {helperText && <p className="mt-1 text-sm text-slate-600">{helperText}</p>}
          </div>
          <Button type="button" onClick={onClose} variant="outline" className="rounded-2xl">
            <CloseIcon className="mr-1 h-4 w-4" />{tr(t, "common.close", "Close")}
          </Button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border p-1.5" role="group" aria-label={tr(t, "handwriting.colorGroup", "Color")}>
            {COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => { setColor(c.value); setEraserMode(false); }}
                className={`h-7 w-7 rounded-full border-2 ${color === c.value && !eraserMode ? "border-slate-950" : "border-transparent"}`}
                style={{ background: c.value }}
                aria-label={tr(t, `handwriting.color.${c.key}`, c.key)}
                aria-pressed={color === c.value && !eraserMode}
              />
            ))}
          </div>
          <div className="inline-flex items-center gap-1 rounded-full border p-1.5" role="group" aria-label={tr(t, "handwriting.sizeGroup", "Thickness")}>
            {SIZES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSize(s.value)}
                className={`flex h-8 w-8 items-center justify-center rounded-full ${size === s.value ? "bg-slate-950" : "bg-white"}`}
                aria-label={tr(t, `handwriting.size.${s.key}`, s.key)}
                aria-pressed={size === s.value}
              >
                <span className="rounded-full" style={{ width: Math.min(s.value, 16), height: Math.min(s.value, 16), background: size === s.value ? "#fff" : "#0f172a" }} />
              </button>
            ))}
          </div>
          <Button type="button" onClick={() => setEraserMode((v) => !v)} variant={eraserMode ? "default" : "outline"} className="rounded-2xl">
            <EraserIcon className="mr-1 h-4 w-4" />{tr(t, "handwriting.eraser", "Eraser")}
          </Button>
          <Button type="button" onClick={undo} variant="outline" className="rounded-2xl" disabled={!strokes.length}>
            <UndoIcon className="mr-1 h-4 w-4" />{tr(t, "handwriting.undo", "Undo")}
          </Button>
          <Button type="button" onClick={clearAll} variant="outline" className="rounded-2xl" disabled={!strokes.length}>
            {tr(t, "handwriting.clearAll", "Clear all")}
          </Button>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`h-[420px] w-full rounded-2xl border bg-white ${eraserMode ? "cursor-cell" : "cursor-crosshair"}`}
          style={{ touchAction: "none" }}
        >
          {existingImage && <image data-handwriting-bg="true" href={existingImage} x="0" y="0" width={CANVAS_WIDTH} height={CANVAS_HEIGHT} preserveAspectRatio="xMidYMid meet" />}
          {strokes.map((stroke, index) => (
            <path key={index} d={pathFor(stroke)} fill={stroke.color} />
          ))}
          {currentPath && <path d={currentPath} fill={color} />}
        </svg>

        <div className="mt-3 flex justify-end">
          <Button type="button" onClick={handleSave} className="rounded-2xl" disabled={!strokes.length && !existingImage}>
            {tr(t, "handwriting.save", "Save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
