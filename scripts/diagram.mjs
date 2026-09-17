/**
 * DEFINIT -- landing-page finality diagram.
 *
 * The landing page described the lifecycle with an ASCII block. This script
 * replaces it with a drawing in the Excalidraw visual language: hand-drawn
 * double strokes, rounded corners, slightly open rectangles.
 *
 * One scene definition emits three artefacts:
 *
 *   public/diagrams/finality-lifecycle.svg         standalone SVG asset
 *   public/diagrams/finality-lifecycle.excalidraw  editable scene source
 *   components/landing/FinalityDiagram.tsx         inlined SVG for the page
 *
 * The page renders the inlined copy so the drawing inherits the site's own
 * typography (Manrope / JetBrains Mono). No font file is downloaded, added or
 * embedded: the hand-drawn character comes from stroke geometry alone.
 *
 * Run: npm run diagram
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const W = 1240;
const H = 752;

const C = {
  paper0: "#FFFDF9",
  paper100: "#F5F1E8",
  ink900: "#131518",
  ink600: "#4A5058",
  ink500: "#6B7078",
  brass100: "#F3E7CE",
  brass600: "#96691F",
  amber: "#A9700F",
  ambersoft: "#F6E9CF",
  rust: "#8F3A2E",
  viridian600: "#1B6A53",
  viridian700: "#14513F",
  viridian100: "#DCEDE6",
};

const MONO = "JetBrains Mono, SFMono-Regular, Cascadia Mono, Consolas, monospace";
const SANS = "Manrope, Segoe UI Variable Text, Segoe UI, Helvetica Neue, Arial, sans-serif";

/* ------------------------------------------------------------------ noise */

/** Deterministic PRNG, so the drawing is byte-identical on every run. */
function rngFor(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rough.js-compatible single line pass.
 *
 * This reproduces the geometry drawing libraries use for a hand-drawn stroke:
 * two passes over a bowed bezier whose control points are jittered inside a
 * roughness envelope. Ported so the output matches what Excalidraw itself
 * renders instead of merely resembling it.
 */
function roughStroke(rng, x1, y1, x2, y2, o) {
  const roughness = o.roughness ?? 1;
  const bowing = o.bowing ?? 1;
  const maxOffset = o.maxRandomnessOffset ?? 2;

  const lengthSq = (x1 - x2) ** 2 + (y1 - y2) ** 2;
  const length = Math.sqrt(lengthSq);

  let gain = 1;
  if (length >= 200 && length <= 500) gain = -0.0016668 * length + 1.233334;
  else if (length > 500) gain = 0.4;

  let offset = maxOffset;
  if (offset * offset * 100 > lengthSq) offset = length / 10;
  const halfOffset = offset / 2;

  const divergePoint = 0.2 + rng() * 0.2;
  const jitter = (amount) => roughness * gain * (rng() * 2 * amount - amount);
  const half = () => jitter(halfOffset);
  const full = () => jitter(offset);

  const midDispX = jitter((bowing * maxOffset * (y2 - y1)) / 200);
  const midDispY = jitter((bowing * maxOffset * (x1 - x2)) / 200);

  const passes = [];
  for (let pass = 0; pass < 2; pass += 1) {
    const j = pass === 0 ? half : full;
    const moveX = j();
    const moveY = j();
    passes.push(
      [
        `M${(x1 + moveX).toFixed(2)} ${(y1 + moveY).toFixed(2)}`,
        `C${(midDispX + x1 + (x2 - x1) * divergePoint + moveX).toFixed(2)} ` +
          `${(midDispY + y1 + (y2 - y1) * divergePoint + moveY).toFixed(2)} ` +
          `${(midDispX + x1 + 2 * (x2 - x1) * divergePoint + moveX).toFixed(2)} ` +
          `${(midDispY + y1 + 2 * (y2 - y1) * divergePoint + moveY).toFixed(2)} ` +
          `${(x2 + moveX).toFixed(2)} ${(y2 + moveY).toFixed(2)}`,
      ].join(" "),
    );
  }
  return passes.join(" ");
}

function strokePath(rng, x1, y1, x2, y2, o) {
  return `<path d="${roughStroke(rng, x1, y1, x2, y2, o)}" />`;
}

/** Rectangle drawn the way a sketch renderer does: four independent sides. */
function rectPaths(rng, x, y, w, h, o) {
  return [
    strokePath(rng, x, y, x + w, y, o),
    strokePath(rng, x + w, y, x + w, y + h, o),
    strokePath(rng, x + w, y + h, x, y + h, o),
    strokePath(rng, x, y + h, x, y, o),
  ].join("");
}

/** Fill polygon, corners nudged the same way the outline is. */
function rectFill(rng, x, y, w, h, o, color) {
  const n = (v) => (o.roughness ?? 1) * (rng() * 2 - 1) * 1.6 + v;
  const pts = [
    [n(x), n(y)],
    [n(x + w), n(y)],
    [n(x + w), n(y + h)],
    [n(x), n(y + h)],
  ];
  const d = `M${pts.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" L")} Z`;
  return `<path d="${d}" fill="${color}" stroke="none" />`;
}

/** Arrow head: two short strokes opening back from the tip. */
function arrowHead(rng, tipX, tipY, fromX, fromY, o, size) {
  const angle = Math.atan2(tipY - fromY, tipX - fromX);
  const spread = size ?? 12;
  const a = angle + Math.PI - 0.42;
  const b = angle + Math.PI + 0.42;
  return (
    strokePath(rng, tipX, tipY, tipX + Math.cos(a) * spread, tipY + Math.sin(a) * spread, o) +
    strokePath(rng, tipX, tipY, tipX + Math.cos(b) * spread, tipY + Math.sin(b) * spread, o)
  );
}

function polylineArrow(rng, points, o) {
  let out = "";
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    // Round the corner: start the next segment slightly past the joint.
    out += strokePath(rng, x1, y1, x2, y2, o);
  }
  const [px, py] = points[points.length - 2];
  const [tx, ty] = points[points.length - 1];
  out += arrowHead(rng, tx, ty, px, py, o);
  return out;
}

function textEl(t) {
  const anchor = t.align === "center" ? "middle" : "start";
  const x = t.x;
  const weight = t.weight ?? 400;
  const family = t.family === "mono" ? MONO : SANS;
  const spacing = t.spacing ? ` letter-spacing="${t.spacing}"` : "";
  const lines = Array.isArray(t.text) ? t.text : [t.text];
  const tspans = lines
    .map((line, i) => {
      const y = t.y + t.fontSize * 0.82 + i * t.fontSize * 1.32;
      return `<tspan x="${x}" y="${y.toFixed(2)}">${escapeXml(line)}</tspan>`;
    })
    .join("");
  return `<text text-anchor="${anchor}" font-family="${family}" font-size="${t.fontSize}" font-weight="${weight}" fill="${t.fill}"${spacing}>${tspans}</text>`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ scene */

const O = { roughness: 1.05, bowing: 1, maxRandomnessOffset: 2.4 };
const ARROW_O = { roughness: 1, bowing: 1, maxRandomnessOffset: 2 };

const BOXES = [
  {
    id: "action",
    title: "ACTION",
    x: 495, y: 44, w: 250, h: 68,
    fill: C.brass100, stroke: C.brass600,
  },
  {
    id: "adjudication",
    title: "ADJUDICATION",
    x: 375, y: 176, w: 490, h: 92,
    fill: C.paper100, stroke: C.ink600,
  },
  {
    id: "accepted",
    title: "ACCEPTED",
    x: 495, y: 326, w: 250, h: 72,
    fill: C.ambersoft, stroke: C.amber,
  },
  {
    id: "finalized",
    title: "FINALIZED",
    x: 495, y: 482, w: 250, h: 72,
    fill: C.viridian100, stroke: C.viridian600,
  },
  {
    id: "settlement",
    title: "SETTLEMENT",
    x: 470, y: 612, w: 300, h: 72,
    fill: C.viridian100, stroke: C.viridian700,
  },
];

const ARROWS = [
  { id: "a", color: C.ink600, points: [[620, 112], [620, 176]] },
  { id: "b", color: C.ink600, points: [[620, 268], [620, 326]] },
  { id: "c", color: C.viridian600, points: [[620, 398], [620, 482]] },
  {
    id: "d",
    color: C.rust,
    dashed: true,
    points: [[745, 362], [1020, 362], [1020, 648], [770, 648]],
  },
];

const TEXTS = [
  { x: 620, y: 60, text: "ACTION", fontSize: 20, weight: 600, family: "mono", fill: C.ink900, align: "center" },
  { x: 620, y: 192, text: "ADJUDICATION", fontSize: 20, weight: 600, family: "mono", fill: C.ink900, align: "center" },
  { x: 620, y: 220, text: "validators independently inspect the same evidence", fontSize: 14, fill: C.ink500, align: "center" },
  { x: 620, y: 340, text: "ACCEPTED", fontSize: 20, weight: 600, family: "mono", fill: C.amber, align: "center" },
  { x: 620, y: 366, text: "provisional, still appealable", fontSize: 13, fill: C.amber, align: "center" },
  { x: 620, y: 496, text: "FINALIZED", fontSize: 20, weight: 600, family: "mono", fill: C.viridian600, align: "center" },
  { x: 620, y: 522, text: "the authority to move value", fontSize: 13, fill: C.viridian600, align: "center" },
  { x: 620, y: 630, text: "SETTLEMENT", fontSize: 20, weight: 600, family: "mono", fill: C.viridian700, align: "center" },
  { x: 620, y: 656, text: "irreversible", fontSize: 13, fill: C.viridian700, align: "center" },
  { x: 1046, y: 456, text: "NO SETTLEMENT", fontSize: 15, weight: 600, fill: C.rust, align: "start" },
  { x: 1046, y: 478, text: "refused while the", fontSize: 13, fill: C.ink500, align: "start" },
  { x: 1046, y: 496, text: "window is open", fontSize: 13, fill: C.ink500, align: "start" },
  {
    x: 40,
    y: 714,
    text: "ACCEPTED is a provisional record. Only FINALIZED authorises release, and release is the only step that moves value.",
    fontSize: 13,
    fill: C.ink500,
    align: "start",
  },
];

const BARRICADE = { x: 1020, y: 468, arm: 20 };

/* ------------------------------------------------------------------- draw */

function renderBody() {
  const groups = [];

  // Fills sit under everything so the outlines stay crisp.
  const fills = BOXES.map((box, index) =>
    rectFill(rngFor(9000 + index * 7), box.x, box.y, box.w, box.h, O, box.fill),
  ).join("");
  groups.push(fills);

  const shapeGroup = BOXES.map((box, index) => {
    const rng = rngFor(1200 + index * 13);
    return `<g stroke="${box.stroke}" stroke-width="2" fill="none">${rectPaths(rng, box.x, box.y, box.w, box.h, O)}</g>`;
  }).join("");
  groups.push(shapeGroup);

  const arrowGroup = ARROWS.map((arrow, index) => {
    const rng = rngFor(4400 + index * 31);
    const dash = arrow.dashed ? ` stroke-dasharray="9 7"` : "";
    return `<g stroke="${arrow.color}" stroke-width="2" fill="none"${dash}>${polylineArrow(rng, arrow.points, ARROW_O)}</g>`;
  }).join("");
  groups.push(arrowGroup);

  const bRng = rngFor(777);
  const barricade =
    `<g stroke="${C.rust}" stroke-width="2.6" fill="none">` +
    strokePath(bRng, BARRICADE.x - 22, BARRICADE.y - BARRICADE.arm, BARRICADE.x + 22, BARRICADE.y + BARRICADE.arm, O) +
    strokePath(bRng, BARRICADE.x + 22, BARRICADE.y - BARRICADE.arm, BARRICADE.x - 22, BARRICADE.y + BARRICADE.arm, O) +
    `</g>`;
  groups.push(barricade);

  return groups.join("\n  ");
}

const TITLE = "How a DEFINIT action becomes settlement";
const DESC =
  "An action is adjudicated by independent validators and lands as ACCEPTED, which is provisional and still appealable. " +
  "Releasing value at that point is refused while the appeal window is open. Only once the decision is FINALIZED may the " +
  "escrow be released into SETTLEMENT.";

function buildSvg({ inline }) {
  const head = inline
    ? `<svg viewBox="0 0 ${W} ${H}" width="100%" height="auto" role="img" aria-labelledby="definit-lifecycle-title definit-lifecycle-desc" preserveAspectRatio="xMidYMid meet">`
    : `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="definit-lifecycle-title definit-lifecycle-desc">`;
  const texts = TEXTS.map(textEl).join("\n  ");
  return [
    head,
    `  <title id="definit-lifecycle-title">${escapeXml(TITLE)}</title>`,
    `  <desc id="definit-lifecycle-desc">${escapeXml(DESC)}</desc>`,
    `  <g stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision">`,
    `  ${renderBody()}`,
    `  <g>${texts}</g>`,
    `  </g>`,
    `</svg>`,
    ``,
  ].join("\n");
}

/* ---------------------------------------------------------------- outputs */

const root = process.cwd();
const publicDir = path.join(root, "public", "diagrams");
mkdirSync(publicDir, { recursive: true });

writeFileSync(path.join(publicDir, "finality-lifecycle.svg"), buildSvg({ inline: false }), "utf8");

const scene = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [],
  appState: { gridSize: null, viewBackgroundColor: C.paper0 },
  files: {},
};

let seedCursor = 100;
let idCursor = 0;
const nextSeed = () => (seedCursor += 17);
const nextId = (prefix) => `${prefix}-${(idCursor += 1)}`;

for (const box of BOXES) {
  scene.elements.push({
    id: nextId("rect"),
    type: "rectangle",
    x: box.x, y: box.y, width: box.w, height: box.h,
    angle: 0,
    strokeColor: box.stroke,
    backgroundColor: box.fill,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    seed: nextSeed(),
    version: 1,
    versionNonce: nextSeed(),
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  });
}

for (const arrow of ARROWS) {
  const [start, ...rest] = arrow.points;
  scene.elements.push({
    id: nextId("arrow"),
    type: "arrow",
    x: start[0], y: start[1],
    width: 0, height: 0,
    angle: 0,
    strokeColor: arrow.color,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: arrow.dashed ? "dashed" : "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 2 },
    seed: nextSeed(),
    version: 1,
    versionNonce: nextSeed(),
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    points: [start, ...rest],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
  });
}

for (const t of TEXTS) {
  const lines = Array.isArray(t.text) ? t.text : [t.text];
  const longest = lines.reduce((acc, line) => Math.max(acc, line.length), 0);
  scene.elements.push({
    id: nextId("text"),
    type: "text",
    x: t.x, y: t.y,
    width: Math.round(longest * t.fontSize * 0.6),
    height: Math.round(lines.length * t.fontSize * 1.32),
    angle: 0,
    strokeColor: t.fill,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: nextSeed(),
    version: 1,
    versionNonce: nextSeed(),
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    text: lines.join("\n"),
    fontSize: t.fontSize,
    fontFamily: t.family === "mono" ? 3 : 2,
    textAlign: t.align === "center" ? "center" : "left",
    verticalAlign: "top",
    containerId: null,
    originalText: lines.join("\n"),
    lineHeight: 1.32,
  });
}

writeFileSync(
  path.join(publicDir, "finality-lifecycle.excalidraw"),
  `${JSON.stringify(scene, null, 2)}\n`,
  "utf8",
);

const component = `/**
 * DEFINIT -- landing-page finality diagram (generated).
 *
 * Produced by \`npm run diagram\` from scripts/diagram.mjs. Edit the scene
 * definition there and regenerate rather than editing this file by hand.
 *
 * The markup is inlined rather than loaded through an <img> so the drawing
 * inherits the page's own typography. The identical drawing is also published
 * as a standalone asset at /diagrams/finality-lifecycle.svg, and the editable
 * scene source sits beside it as /diagrams/finality-lifecycle.excalidraw.
 */

export function FinalityDiagram() {
  return (
    <div
      className="w-full overflow-hidden [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
      dangerouslySetInnerHTML={{ __html: MARKUP }}
    />
  );
}

const MARKUP = ${JSON.stringify(buildSvg({ inline: true }))};
`;

mkdirSync(path.join(root, "components", "landing"), { recursive: true });
writeFileSync(path.join(root, "components", "landing", "FinalityDiagram.tsx"), component, "utf8");

process.stdout.write(
  [
    "diagram: wrote",
    "  public/diagrams/finality-lifecycle.svg",
    "  public/diagrams/finality-lifecycle.excalidraw",
    "  components/landing/FinalityDiagram.tsx",
    "",
  ].join("\n"),
);
