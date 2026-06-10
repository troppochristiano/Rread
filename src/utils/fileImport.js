// Extract plain text from an uploaded File (TXT, PDF, EPUB).
// PDF and EPUB libraries are loaded on demand so they don't bloat the initial bundle.

const TXT_EXT = /\.(txt|md|markdown|text)$/i;
const PDF_EXT = /\.pdf$/i;
const EPUB_EXT = /\.epub$/i;

export const ACCEPT_FILE_TYPES = ".txt,.md,.markdown,.text,.pdf,.epub";

export async function importFileToText(file) {
  if (!file) throw new Error("No file");

  const name = file.name || "";
  const type = file.type || "";

  if (TXT_EXT.test(name) || type.startsWith("text/")) {
    return normalizeWhitespace(await file.text());
  }
  if (PDF_EXT.test(name) || type === "application/pdf") {
    return readPdf(await file.arrayBuffer());
  }
  if (EPUB_EXT.test(name) || type === "application/epub+zip") {
    return readEpub(await file.arrayBuffer());
  }
  throw new Error(`Unsupported file type: ${name || type || "unknown"}`);
}

// iOS Safari < 17.4 supports ReadableStream but not async iteration over it
// (`for await (… of stream)`), which pdf.js relies on during text extraction.
// Adding the iterator lets PDFs import on those older devices.
function ensureReadableStreamAsyncIterator() {
  if (typeof ReadableStream === "undefined") return;
  const proto = ReadableStream.prototype;
  if (proto[Symbol.asyncIterator]) return;

  proto[Symbol.asyncIterator] = function ({ preventCancel = false } = {}) {
    const reader = this.getReader();
    return {
      next() {
        return reader.read();
      },
      async return(value) {
        if (preventCancel) {
          reader.releaseLock();
        } else {
          const cancelPromise = reader.cancel(value);
          reader.releaseLock();
          await cancelPromise;
        }
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
  if (!proto.values) proto.values = proto[Symbol.asyncIterator];
}

async function readPdf(arrayBuffer) {
  ensureReadableStreamAsyncIterator();
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }

  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pageTexts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pageTexts.push(joinPdfItems(content.items));
  }
  return normalizeWhitespace(pageTexts.join("\n\n"));
}

// pdf.js gives one item per text run; rebuild rough line breaks using its
// EOL hint and the y-coordinate transform.
function joinPdfItems(items) {
  let out = "";
  let lastY = null;
  for (const it of items) {
    const y = it.transform ? it.transform[5] : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) out += "\n";
    out += it.str;
    if (it.hasEOL) out += "\n";
    else out += " ";
    lastY = y;
  }
  return out;
}

async function readEpub(arrayBuffer) {
  const ePub = (await import("epubjs")).default;
  const book = ePub(arrayBuffer);
  await book.opened;

  const items = book.spine?.spineItems || [];
  const parts = [];
  for (const item of items) {
    try {
      const doc = await item.load(book.load.bind(book));
      const body = doc?.body || doc?.querySelector?.("body");
      if (body) {
        const text = body.textContent?.trim();
        if (text) parts.push(text);
      }
      item.unload();
    } catch {
      // skip unreadable section, keep going
    }
  }
  try { book.destroy(); } catch { /* noop */ }

  return normalizeWhitespace(parts.join("\n\n"));
}

function normalizeWhitespace(s) {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
