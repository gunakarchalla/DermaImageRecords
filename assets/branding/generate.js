/**
 * Generates the DermaImageRecords app icon set.
 *
 * Mark: a clinical photo frame split down the middle — the "before" panel carries a
 * prominent lesion, the "after" panel the same lesion faded — i.e. the before/after
 * comparison the app is built around. Palette follows the app: slate-900 (#0f172a)
 * surface, white frame, rose (#fb7185) lesion as the single accent.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const OUT_SVG = path.join(__dirname, "svg");
const OUT_PNG = path.join(__dirname, "png");
fs.mkdirSync(OUT_SVG, { recursive: true });
fs.mkdirSync(OUT_PNG, { recursive: true });

const SLATE = "#0f172a";
const SLATE_LIGHT = "#1e293b";
const ROSE = "#fb7185";

/**
 * Closed organic blob (the lesion), as a smooth cardinal-spline through points at
 * `radii` around (cx,cy). A perfect circle reads as a UI dot; an irregular one reads
 * as a skin lesion — and it still resolves to a dot at favicon sizes.
 */
function blobPath(cx, cy, radii, tension = 0.5) {
  const n = radii.length;
  const pt = (i) => {
    const a = (2 * Math.PI * ((i + n) % n)) / n - Math.PI / 2;
    const r = radii[(i + n) % n];
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  let d = `M ${pt(0)[0].toFixed(1)} ${pt(0)[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pt(i - 1), [x1, y1] = pt(i), [x2, y2] = pt(i + 1), [x3, y3] = pt(i + 2);
    const c1x = x1 + ((x2 - x0) / 6) * tension * 2;
    const c1y = y1 + ((y2 - y0) / 6) * tension * 2;
    const c2x = x2 - ((x3 - x1) / 6) * tension * 2;
    const c2y = y2 - ((y3 - y1) / 6) * tension * 2;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  return d + " Z";
}

// "Before" lesion: large and irregular. "After": the same lesion, small and settled.
// The story is told by size, not opacity — a translucent rose muddies on dark.
const LESION_BEFORE = blobPath(364, 512, [84, 92, 78, 88, 82, 94, 76, 90]);
const LESION_AFTER = blobPath(660, 512, [34, 38, 32, 36, 33, 39, 31, 37]);

/**
 * The mark, on a 1024x1024 canvas, centered on (512,512).
 * `scale` shrinks it around the center (adaptive-icon safe zone).
 */
function mark({ fg = "#ffffff", dot = ROSE, scale = 1 } = {}) {
  return `<g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
    <rect x="216" y="216" width="592" height="592" rx="88"
          fill="none" stroke="${fg}" stroke-width="40" />
    <line x1="512" y1="216" x2="512" y2="808"
          stroke="${fg}" stroke-width="28" stroke-linecap="butt" />
    <path d="${LESION_BEFORE}" fill="${dot}" />
    <path d="${LESION_AFTER}" fill="${dot}" />
  </g>`;
}

/** Simplified mark for tiny sizes (favicon): heavier strokes, tighter frame. */
function markSimple({ fg = "#ffffff", dot = ROSE } = {}) {
  return `
    <rect x="176" y="248" width="672" height="528" rx="72"
          fill="none" stroke="${fg}" stroke-width="64" />
    <line x1="512" y1="248" x2="512" y2="776" stroke="${fg}" stroke-width="48" />
    <path d="${blobPath(344, 512, [100, 110, 92, 106, 98, 112, 90, 108])}" fill="${dot}" />
    <path d="${blobPath(680, 512, [42, 47, 40, 45, 41, 48, 39, 46])}" fill="${dot}" />`;
}

const svgDoc = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">\n${body}\n</svg>\n`;

const slateBg = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${SLATE_LIGHT}" />
      <stop offset="1" stop-color="${SLATE}" />
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)" />`;

const assets = {
  // iOS / store icon: full-bleed, opaque.
  "icon": { svg: svgDoc(slateBg + mark()), size: 1024 },

  // Android adaptive icon: foreground must sit inside the 66% safe circle.
  "android-icon-foreground": { svg: svgDoc(mark({ scale: 0.64 })), size: 1024 },
  "android-icon-background": { svg: svgDoc(slateBg), size: 1024 },
  // Themed icon: single-colour silhouette on transparent; the system tints it.
  "android-icon-monochrome": {
    svg: svgDoc(mark({ fg: "#ffffff", dot: "#ffffff", scale: 0.64 })),
    size: 1024,
  },

  // Splash: transparent, drawn on the plugin's white (light) / black (dark) background.
  "splash-icon": { svg: svgDoc(mark({ fg: SLATE })), size: 1024 },
  "splash-icon-dark": { svg: svgDoc(mark({ fg: "#ffffff" })), size: 1024 },

  // Web favicon: simplified so it survives 16px.
  "favicon": {
    svg: svgDoc(`<rect width="1024" height="1024" rx="224" fill="${SLATE}" />` + markSimple()),
    size: 96,
  },
};

(async () => {
  for (const [name, { svg, size }] of Object.entries(assets)) {
    fs.writeFileSync(path.join(OUT_SVG, `${name}.svg`), svg);
    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT_PNG, `${name}.png`));
    console.log(`${name}.png  ${size}x${size}`);
  }
  // Contact sheet: mark at real sizes, on light and dark, for eyeballing legibility.
  const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="360" viewBox="0 0 900 360">
    <rect x="0" y="0" width="450" height="360" fill="#ffffff"/>
    <rect x="450" y="0" width="450" height="360" fill="#020617"/>
    ${[192, 96, 48, 24].reduce((acc, s, i) => {
      const x = 40 + [0, 220, 340, 410][i];
      return acc + `<g transform="translate(${x} ${180 - s / 2}) scale(${s / 1024})">${slateBg}${mark()}</g>`
        + `<g transform="translate(${x + 450} ${180 - s / 2}) scale(${s / 1024})">${slateBg}${mark()}</g>`;
    }, "")}
  </svg>`;
  await sharp(Buffer.from(preview)).png().toFile(path.join(OUT_PNG, "_preview.png"));
  console.log("_preview.png");
})();
