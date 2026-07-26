// OCR fallback for scanned/photographed PDFs — extract.ts's normal PDF path
// (model-gateway.ts's convertToMarkdown(), Workers AI's Markdown Conversion
// service) only pulls an EXISTING text layer out of a PDF; a scanned
// document has no text layer at all, just page images, so that path comes
// back empty (see extract.ts's header comment on the 40-character
// threshold check). This file is the real fix for that case: pull the
// embedded page images back out of the PDF and run them through the same
// vision model genuine photo uploads already use.
//
// The chain, and why each link is here:
//   1. `unpdf` (github.com/unjs/unpdf) parses the PDF and extracts each
//      page's embedded raster image as raw decoded pixels
//      (Uint8ClampedArray + width/height/channels). Chosen specifically
//      because it ships a serverless PDF.js build made for edge runtimes
//      including Cloudflare Workers — no separate WASM wiring needed for
//      this half.
//   2. Workers AI's vision model rejects raw decoded pixel data outright
//      (confirmed via a real report of the exact same unpdf->Workers AI
//      pattern failing with error 3010 "Unsupported image data" on
//      Cloudflare's own developer Discord) — it needs an actual encoded
//      image FILE (a real JPEG/PNG bitstream), not a pixel array. So the
//      raw pixels have to be re-encoded into a real PNG file before the
//      vision model will accept them.
//   3. `@jsquash/png` does that re-encoding. It's a WASM PNG encoder built
//      specifically to run in strict/no-eval environments like Cloudflare
//      Workers (unlike Node's `canvas`, which explicitly does NOT work in
//      workerd — see https://github.com/unjs/unpdf/issues/10). Its .wasm
//      binary is imported as a checked-in base64 string constant
//      (squoosh-png-wasm.generated.ts), not as a raw `.wasm` file — two
//      different webpack asset-import approaches (the asyncWebAssembly
//      experiment, then a dedicated asset/inline rule) both hit real
//      `npm run cf:build` failures; see that generated file's header
//      comment for the full root-cause chain. Decoded back to raw bytes
//      via atob() at runtime, then handed to wasm-bindgen's own init(),
//      same as the working raw-Wrangler case.
//
// UNVERIFIED AGAINST A LIVE DEPLOY. This was built and typechecked in a
// sandbox with no live Cloudflare Workers AI credentials and no way to
// actually run a scanned PDF through it end-to-end — only a real
// `npm run cf:build` (confirmed passing after the base64-import fix) could
// confirm the WASM import bundles; nothing yet has confirmed it
// instantiates correctly at runtime or that the re-encoded PNG is
// byte-correct or that the vision model actually reads it well. Test with
// a real scanned document before trusting this in production. Every
// function here is wrapped by extract.ts in a try/catch that falls back to
// the existing clear "scanned document not supported" error on ANY
// failure — so a bug here degrades to today's honest error message, not a
// crash.

import { getDocumentProxy, extractImages } from "unpdf";
import initPngEncoder, { init as initPngWasm } from "@jsquash/png/encode";
// Checked-in base64 of squoosh_png_bg.wasm, NOT a raw `.wasm` file import.
// See squoosh-png-wasm.generated.ts's header comment for exactly why: a
// direct `.wasm` import here (via any webpack asset-module type — tried
// both the asyncWebAssembly experiment and an explicit asset/inline rule,
// confirmed both fail via real npm run cf:build errors) runs into
// Next.js's own webpack config, which is out of this project's control.
// Importing a plain string constant is ordinary JavaScript — no asset
// module machinery involved at all.
import { SQUOOSH_PNG_WASM_BASE64 } from "./squoosh-png-wasm.generated";

function base64ToBytes(base64: string): Uint8Array {
  // atob is a standard Web API, available in the Workers runtime same as
  // any browser — no extra dependency needed to decode this.
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let pngWasmInitialized = false;
async function ensurePngWasmInitialized(): Promise<void> {
  if (pngWasmInitialized) return;
  await initPngWasm(base64ToBytes(SQUOOSH_PNG_WASM_BASE64));
  pngWasmInitialized = true;
}

// jSquash's PNG encoder expects browser-ImageData-shaped RGBA input
// (4 bytes/pixel: R, G, B, A) — unpdf's extracted images can come back as
// 1 (grayscale), 3 (RGB), or 4 (RGBA) channels depending on the original
// embedded image's color space. Textbook conversions: grayscale replicates
// the single value into R/G/B; RGB gets a fully-opaque alpha channel
// appended. No compression or resampling here, just channel-count padding.
function toRgba(data: Uint8ClampedArray, channels: 1 | 3 | 4, width: number, height: number): Uint8ClampedArray {
  if (channels === 4) {
    return new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  }
  const pixelCount = width * height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    if (channels === 1) {
      // noUncheckedIndexedAccess (tsconfig.json) makes every typed-array
      // index read `number | undefined` — the `?? 0` fallbacks are pure
      // type satisfaction, not a real runtime case: i only ever ranges over
      // [0, pixelCount), which is exactly data's length for channels === 1.
      const v = data[i] ?? 0;
      rgba[i * 4] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    } else {
      rgba[i * 4] = data[i * 3] ?? 0;
      rgba[i * 4 + 1] = data[i * 3 + 1] ?? 0;
      rgba[i * 4 + 2] = data[i * 3 + 2] ?? 0;
      rgba[i * 4 + 3] = 255;
    }
  }
  return rgba;
}

export interface ScannedPdfPage {
  pageNumber: number;
  pngBytes: ArrayBuffer;
}

// Caps how many pages get OCR'd on one document — Form 26AS/AIS can run
// long for someone with a lot of transactions, and each page here is a
// full PDF-image-extract + WASM-encode + vision-model round trip. This is
// a real cost/latency/Worker-CPU-time guard, not an arbitrary limit;
// extract.ts's caller surfaces a note in raw_output if a document was
// truncated so it's visible, not silently dropped.
export const MAX_OCR_PAGES = 25;

export async function extractScannedPdfPageImages(bytes: ArrayBuffer): Promise<ScannedPdfPage[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pageCount = Math.min(pdf.numPages, MAX_OCR_PAGES);
  const pages: ScannedPdfPage[] = [];

  await ensurePngWasmInitialized();

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const images = await extractImages(pdf, pageNumber);
    if (images.length === 0) continue;
    // A scanned page is realistically one embedded image covering the
    // whole page (that's how every scan-to-PDF tool — a flatbed scanner,
    // CamScanner, Adobe Scan, a phone's own scan feature — produces a
    // page). If a page happens to have multiple embedded images (e.g. a
    // logo plus a body scan), take the largest by pixel area — the actual
    // page content, not a small decorative image.
    const largest = images.reduce((biggest, img) =>
      img.width * img.height > biggest.width * biggest.height ? img : biggest
    );
    const rgba = toRgba(largest.data, largest.channels, largest.width, largest.height);
    // jSquash's encode() types its `data` param as the DOM's real ImageData
    // interface (not a lookalike) — that interface requires `colorSpace`
    // (TS lib.dom.d.ts), even though jSquash's own WASM encoder ignores it
    // entirely and always encodes as sRGB. "srgb" here is just satisfying
    // the type, not a meaningful runtime choice — a scanned PDF page's
    // embedded image doesn't carry its own colorSpace metadata through
    // unpdf's extractImages() to make a different value meaningful anyway.
    const pngBytes = await initPngEncoder({
      data: rgba,
      width: largest.width,
      height: largest.height,
      colorSpace: "srgb",
    });
    pages.push({ pageNumber, pngBytes });
  }

  return pages;
}

// Combines per-page extraction JSON into one result. Array-valued fields
// (e.g. a document's list of TDS entries) accumulate across pages, since
// that's genuinely per-row data spread across a multi-page document.
// Scalar fields (e.g. PAN, assessment year) take the first non-empty value
// found on any page — those are document-level identity fields that
// should read the same everywhere they appear, not something to merge.
export function mergeExtractedPages(pageResults: Record<string, unknown>[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const page of pageResults) {
    for (const [key, value] of Object.entries(page)) {
      if (Array.isArray(value)) {
        const existing = Array.isArray(merged[key]) ? (merged[key] as unknown[]) : [];
        merged[key] = [...existing, ...value];
      } else if (merged[key] === undefined || merged[key] === null || merged[key] === "") {
        merged[key] = value;
      }
    }
  }
  return merged;
}
