import { useEffect, useRef, useState } from "react";
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

const TEMPLATE_FONT_SIZE = 30;
const TEMPLATE_LINE_HEIGHT = 42;
const TEMPLATE_MARGIN_X = 44;
const TEMPLATE_MARGIN_TOP = 54;
const TEMPLATE_MAX_CHARS = 96;

// Word-wrap the item's helper texts into canvas lines, preserving the author's own line breaks.
// Rendered light-grey onto the sketch as a template the examiner annotates over (Task 1).
function wrapTemplateLines(text, maxChars) {
  const lines = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    if (!paragraph.trim()) { lines.push(""); continue; }
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      if (current && (current + " " + word).length > maxChars) {
        lines.push(current);
        current = word;
      } else {
        current = current ? current + " " + word : word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// Shared handwriting/sketch tool for stylus input, used both by the Candidate's field
// report notes and the Examiner's outdoor scoring notes.
//
// Input policy (deliberate, see the examiner request): only a *pen/stylus* (or a desktop mouse)
// draws. A finger (pointerType "touch") never draws — instead a finger drag scrolls the pad's
// scroll container, so the examiner can reach the lower part of the (taller, `tallCanvas`) writing
// area without leaving stray ink from a resting hand. Strokes are kept as vector point data (not
// baked into the canvas immediately) so color/thickness/eraser/undo all just add or remove entries
// from `strokes` — the visible ink is only ever a re-render.
export function HandwritingPad({ onClose, onSave, title, helperText, existingImage, tallCanvas = false, templateText = "", t, Button, CloseIcon, EraserIcon, UndoIcon }) {
  const svgRef = useRef(null);
  const scrollRef = useRef(null);
  // Active finger-scroll gesture: { pointerId, startClientY, startScrollTop }. Only ever set for
  // pointerType "touch"; a pen/mouse leaves it null so those keep drawing.
  const touchScrollRef = useRef(null);
  const drawingRef = useRef(false);
  const activePointerIdRef = useRef(null);
  const [strokes, setStrokes] = useState([]);
  const [currentPoints, setCurrentPoints] = useState(null);
  const [color, setColor] = useState(COLORS[0].value);
  const [size, setSize] = useState(SIZES[1].value);
  const [eraserMode, setEraserMode] = useState(false);
  const [maximized, setMaximized] = useState(false);

  // `tallCanvas` doubles the vertical writing area (a genuinely taller viewBox, not just a
  // letterboxed box), giving ~2× the room the examiner asked for; the extra height overflows the
  // dialog and is reached by scrolling (with a finger — see the touch branch below).
  const canvasHeight = tallCanvas ? CANVAS_HEIGHT * 2 : CANVAS_HEIGHT;

  // Task 1: the item's helper texts (without the question text) are copied into the sketch as a
  // light-grey template the examiner annotates over. It is part of the drawing (not the stripped
  // background <image>), so it bakes into the saved PNG.
  const templateLines = templateText ? wrapTemplateLines(templateText, TEMPLATE_MAX_CHARS) : [];

  function isDrawingPointer(event) {
    // Pen and mouse draw; touch (finger) does not. Some Bluetooth/EMR styluses on Android report
    // "touch" rather than "pen", but on the tablets this exam runs on (iPad + Apple Pencil) the
    // Pencil reports "pen" reliably and finger palm-rejection is the actual requirement.
    return event.pointerType !== "touch";
  }

  // A finger on the drawing surface must scroll (not draw and not let the browser hijack the
  // gesture). touch-action:none keeps the browser from scrolling on its own, so we move the scroll
  // container by hand from the touch delta. The native non-passive touch listeners below stop the
  // browser's default touch handling that React's passive handlers can't.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const prevent = (event) => { event.preventDefault(); };
    el.addEventListener("touchstart", prevent, { passive: false });
    el.addEventListener("touchmove", prevent, { passive: false });
    return () => {
      el.removeEventListener("touchstart", prevent);
      el.removeEventListener("touchmove", prevent);
    };
  }, []);

  function svgPoint(event) {
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    // The <svg> keeps its default preserveAspectRatio ("xMidYMid meet"), so unless the
    // element's on-screen box happens to have exactly the CANVAS_WIDTH:canvasHeight ratio,
    // the viewBox content is letterboxed (centered, with blank padding on two sides) inside
    // that box. Reproduce the same "meet" fit here so the ink lands under the stylus tip.
    const viewBoxAspect = CANVAS_WIDTH / canvasHeight;
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
    const y = ((event.clientY - rect.top - offsetY) / renderHeight) * canvasHeight;
    const pressure = event.pressure > 0 ? event.pressure : 0.5;
    return [x, y, pressure];
  }

  function eraseAt(point) {
    setStrokes((prev) => prev.filter((stroke) => !strokeHitTest(stroke, point, ERASER_RADIUS)));
  }

  function handlePointerDown(event) {
    // Finger: start a scroll-drag instead of drawing. Don't preventDefault (the native touch
    // listener already did) and don't capture — we just track the delta and move scrollTop.
    if (!isDrawingPointer(event)) {
      touchScrollRef.current = {
        pointerId: event.pointerId,
        startClientY: event.clientY,
        startScrollTop: scrollRef.current ? scrollRef.current.scrollTop : 0,
      };
      return;
    }
    // A second pointer arriving while the first is still drawing is the real palm-rejection case
    // (a hand resting on the tablet while the stylus is down) — ignore it.
    if (drawingRef.current && activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    // Pointer capture can fail on some browser/input combinations; that must not stop the stroke.
    try { svgRef.current?.setPointerCapture?.(event.pointerId); } catch { /* not fatal */ }
    drawingRef.current = true;
    activePointerIdRef.current = event.pointerId;
    const point = svgPoint(event);
    if (eraserMode) eraseAt(point);
    else setCurrentPoints([point]);
  }

  function handlePointerMove(event) {
    // Finger scroll-drag: translate the vertical finger movement into scrollTop.
    if (touchScrollRef.current && event.pointerId === touchScrollRef.current.pointerId) {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = touchScrollRef.current.startScrollTop - (event.clientY - touchScrollRef.current.startClientY);
      }
      return;
    }
    if (!drawingRef.current || event.pointerId !== activePointerIdRef.current) return;
    event.preventDefault();
    const point = svgPoint(event);
    if (eraserMode) eraseAt(point);
    else setCurrentPoints((prev) => (prev ? [...prev, point] : [point]));
  }

  function handlePointerUp(event) {
    if (touchScrollRef.current && event.pointerId === touchScrollRef.current.pointerId) {
      touchScrollRef.current = null;
      return;
    }
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
    // rasterizing it — it's drawn separately onto the canvas below via drawImage.
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
      canvas.height = canvasHeight;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_WIDTH, canvasHeight);
      if (background) ctx.drawImage(background, 0, 0, CANVAS_WIDTH, canvasHeight);
      ctx.drawImage(strokesImage, 0, 0);
      onSave(canvas.toDataURL("image/png"));
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  }

  const currentPath = currentPoints && currentPoints.length > 1 ? getSvgPathFromStroke(getStroke(currentPoints, { ...STROKE_OPTIONS, size })) : "";
  // Non-maximized tall canvas: give the <svg> its true aspect ratio so the doubled height is real
  // drawing space (which then overflows the dialog and scrolls) rather than a letterboxed band.
  const svgSizeClass = maximized ? "min-h-0 flex-1" : tallCanvas ? "w-full" : "h-[420px]";
  const svgSizeStyle = !maximized && tallCanvas ? { aspectRatio: `${CANVAS_WIDTH} / ${canvasHeight}`, height: "auto" } : {};

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 ${maximized ? "p-0" : "p-4"}`}>
      <div ref={scrollRef} className={`flex w-full flex-col overflow-auto bg-white shadow-xl ${maximized ? "h-full max-h-none max-w-none rounded-none p-3" : "max-h-[95vh] max-w-4xl rounded-2xl p-4"}`}>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            {helperText && <p className="mt-1 text-sm text-slate-600">{helperText}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => setMaximized((v) => !v)} variant="outline" className="rounded-2xl">
              {maximized ? tr(t, "handwriting.restore", "Restore") : tr(t, "handwriting.maximize", "Maximize")}
            </Button>
            <Button type="button" onClick={onClose} variant="outline" className="rounded-2xl">
              <CloseIcon className="mr-1 h-4 w-4" />{tr(t, "common.close", "Close")}
            </Button>
          </div>
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

        {tallCanvas && <p className="mb-2 text-xs text-slate-500">{tr(t, "handwriting.fingerScrollHint", "Draw with the stylus; drag with a finger to scroll for more writing space.")}</p>}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${CANVAS_WIDTH} ${canvasHeight}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`shrink-0 rounded-2xl border bg-white ${svgSizeClass} ${eraserMode ? "cursor-cell" : "cursor-crosshair"}`}
          style={{ touchAction: "none", overscrollBehavior: "contain", WebkitUserSelect: "none", userSelect: "none", ...svgSizeStyle }}
        >
          {existingImage && <image data-handwriting-bg="true" href={existingImage} x="0" y="0" width={CANVAS_WIDTH} height={canvasHeight} preserveAspectRatio="xMidYMid meet" />}
          {templateLines.length > 0 && (
            <text x={TEMPLATE_MARGIN_X} y={TEMPLATE_MARGIN_TOP} fill="#94a3b8" fontSize={TEMPLATE_FONT_SIZE} fontFamily="ui-sans-serif, system-ui, sans-serif">
              {templateLines.map((line, index) => (
                <tspan key={index} x={TEMPLATE_MARGIN_X} dy={index === 0 ? 0 : TEMPLATE_LINE_HEIGHT}>{line || " "}</tspan>
              ))}
            </text>
          )}
          {strokes.map((stroke, index) => (
            <path key={index} d={pathFor(stroke)} fill={stroke.color} />
          ))}
          {currentPath && <path d={currentPath} fill={color} />}
        </svg>

        {/* Sticky: with a tall canvas the footer used to sit far below the fold, so on a tablet the
            dialog looked like it only offered "Close" and the examiner could not find Save. */}
        <div className="sticky bottom-0 mt-3 flex justify-end gap-2 border-t border-slate-200 bg-white/95 py-2">
          <Button type="button" onClick={handleSave} className="rounded-2xl" disabled={!strokes.length && !existingImage && templateLines.length === 0}>
            {tr(t, "handwriting.save", "Save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
