// Bug: real Form 16/16A/26AS/AIS certificates blank on extraction (both
// Workers AI and OpenAI, identically) despite obviously-legible source
// PDFs — logged and root-caused here.
//
// Root cause: many real Indian tax/payroll certificates (this one
// confirmed against a real Form 16 the account holder provided, generated
// by an Adobe LiveCycle Designer XFA dynamic form — the classic giveaway
// is field names like "data[0].FORM16_BODY_PAGE1[0].FORM16[0]...") don't
// store their actual values as ordinary page text at all. The visible
// numbers (PAN, TAN, quarterly TDS amounts, gross salary, tax payable —
// literally every value field on the certificate) live exclusively as
// AcroForm field values (PDF's /V entries), a completely separate
// structure from the page's content-stream text. Confirmed directly
// against the real fixture: pdfplumber's/Cloudflare Markdown Conversion's
// ordinary text-layer extraction returns every one of the form's static
// labels ("PAN of the Employee", "Quarter 1", "Gross salary") but not one
// of the values sitting in the adjacent cell, while the values are all
// present and correct in the form's field tree.
//
// extract.ts's existing looksLikeScannedPdf() safeguard doesn't catch
// this: that check is "is the TOTAL extracted text suspiciously short"
// (<40 chars), and a form like this has plenty of label text — hundreds
// of characters — so it sails past that check and straight into the text
// model with a markdown blob that LOOKS complete but structurally
// contains zero of the actual data. The model isn't hallucinating or
// misreading the prompt — it's correctly reporting that it can't see any
// values, because it genuinely wasn't given any. Every required field
// scoring "missing" and confidence bottoming out at scoreExtraction()'s
// 0.2 floor is the expected, honest result of that input, not a scoring
// bug.
//
// Fix: pull the AcroForm field values back out separately (unpdf's
// PDFDocumentProxy — the same object pdf-ocr.ts already gets from
// getDocumentProxy() — exposes pdf.js's own getFieldObjects(), no new
// dependency needed) and hand them to the model as a second, explicit
// block alongside the label-only markdown, rather than relying on the
// text layer alone. Field names are dotted XFA paths
// ("data[0].FORM16_BODY_PAGE1[0]...ENAME[0]") that don't read as
// human labels on their own, so this deliberately does NOT try to
// re-derive "PAN of the Employee" from "ICNUM" — it hands the model
// short field-name-fragment: value pairs and lets it do the same
// label-to-value matching a human reviewer would do by looking at the
// certificate's layout (matching by position/order against the labels
// already in the surrounding markdown), which is squarely within a
// modern instruction-following model's ability and far more robust than
// a hand-maintained field-name-to-schema-key mapping that would need
// updating every time a template's schema changes.
import { getDocumentProxy } from "unpdf";

interface PdfFieldObject {
  value?: unknown;
  type?: string;
}

// Last 1-2 non-array-index path segments, not the full dotted XFA path —
// short enough not to bloat the prompt across a ~200-field real
// certificate (see this file's header: confirmed 218 value-bearing
// fields / ~4.7KB as one flat list on the real Form 16 fixture), while
// usually still carrying SOME signal (ENAME, PANNO, GROSS_SAL read as
// recognizable abbreviations even stripped of their parent path). Field
// names that repeat across several values (e.g. a generic "TextField8"
// used for every cell in a quarterly table) are intentionally left
// ambiguous rather than disambiguated here — see header comment on why
// that's left to the model's own layout-matching rather than solved with
// brittle path-parsing.
function shortLabel(fullPath: string): string {
  const cleaned = fullPath.replace(/\[\d+\]/g, "");
  const segments = cleaned.split(".").filter(Boolean);
  return segments[segments.length - 1] || fullPath;
}

// Returns null (never throws) on any PDF without a usable AcroForm field
// tree, or with one but no non-empty text values — the overwhelming
// majority of documents this pipeline sees (synthetic fixtures, scanned
// images, plain generated PDFs with a real text layer) fall straight
// through here as a no-op, exactly as before this existed. Every caller
// wraps this in the same "degrade to today's behavior on any failure"
// posture as pdf-ocr.ts's extractScannedPdfPageImages().
export async function extractPdfFormFieldText(bytes: ArrayBuffer): Promise<string | null> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const fields = await pdf.getFieldObjects();
  if (!fields) return null;

  const lines: string[] = [];
  for (const [path, objs] of Object.entries(fields as Record<string, PdfFieldObject[]>)) {
    for (const obj of objs) {
      if (obj.type !== "text") continue;
      if (typeof obj.value !== "string") continue;
      const value = obj.value.trim();
      if (!value) continue;
      lines.push(`${shortLabel(path)}: ${value}`);
    }
  }
  if (lines.length === 0) return null;

  return (
    "Form field values extracted separately from this PDF's fillable form fields " +
    "(these are the actual filled-in values — the page text above may only contain " +
    "static labels/headings with no values, which is normal for this kind of " +
    "certificate; match each value below to the correct label above by position/order " +
    "and field-name hints):\n" +
    lines.join("\n")
  );
}
