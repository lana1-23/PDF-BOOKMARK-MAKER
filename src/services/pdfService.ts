import { PDFDocument, PDFName, PDFDict, PDFNumber, PDFRef, PDFHexString } from 'pdf-lib';

export interface Bookmark {
  title: string;
  page: number;
  level: number;
}

/**
 * Encodes a string as a PDF Unicode Hex String (UTF-16BE with BOM).
 */
function createUnicodePDFHexString(text: string): PDFHexString {
  let hex = 'FEFF'; // BOM
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    hex += code.toString(16).padStart(4, '0').toUpperCase();
  }
  return PDFHexString.of(hex);
}

/**
 * Adds hierarchical bookmarks (outlines) to a PDF document.
 */
export async function addBookmarksToPdf(pdfBytes: Uint8Array, bookmarks: Bookmark[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const context = pdfDoc.context;
  const pages = pdfDoc.getPages();

  const outlinesDict = context.obj({
    Type: PDFName.of('Outlines'),
  });
  const outlinesRef = context.register(outlinesDict);

  const itemRefs: PDFRef[] = [];
  const itemDicts: PDFDict[] = [];

  // 1. Create all item dictionaries first
  for (const bookmark of bookmarks) {
    // Ensure page number is within valid range [1, pages.length]
    const safePage = Math.min(Math.max(1, bookmark.page), pages.length);
    const pageIndex = safePage - 1;
    const pageRef = pages[pageIndex].ref;

    const itemDict = context.obj({
      Title: createUnicodePDFHexString(bookmark.title),
      A: context.obj({
        S: PDFName.of('GoTo'),
        D: context.obj([pageRef, PDFName.of('XYZ'), null, null, null]),
      }),
    });
    const ref = context.register(itemDict);
    itemRefs.push(ref);
    itemDicts.push(itemDict);
  }

  // 2. Build the hierarchy
  const stack: { ref: PDFRef; dict: PDFDict; level: number }[] = [];
  const rootItems: PDFRef[] = [];

  for (let i = 0; i < bookmarks.length; i++) {
    const current = { ref: itemRefs[i], dict: itemDicts[i], level: bookmarks[i].level };

    // Find parent
    while (stack.length > 0 && stack[stack.length - 1].level >= current.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      // Root level item
      current.dict.set(PDFName.of('Parent'), outlinesRef);
      rootItems.push(current.ref);
    } else {
      // Child item
      const parent = stack[stack.length - 1];
      current.dict.set(PDFName.of('Parent'), parent.ref);

      // Update parent's First/Last
      if (!parent.dict.has(PDFName.of('First'))) {
        parent.dict.set(PDFName.of('First'), current.ref);
      }
      parent.dict.set(PDFName.of('Last'), current.ref);

      // Update parent's Count (negative means closed by default)
      const currentCount = (parent.dict.get(PDFName.of('Count')) as PDFNumber)?.asNumber() || 0;
      parent.dict.set(PDFName.of('Count'), PDFNumber.of(currentCount - 1));
    }

    // Link siblings
    const prevInSameLevel = findPrevSibling(i, bookmarks, itemRefs, context);
    if (prevInSameLevel) {
      current.dict.set(PDFName.of('Prev'), prevInSameLevel.ref);
      prevInSameLevel.dict.set(PDFName.of('Next'), current.ref);
    }

    stack.push(current);
  }

  // 3. Link root items
  if (rootItems.length > 0) {
    outlinesDict.set(PDFName.of('First'), rootItems[0]);
    outlinesDict.set(PDFName.of('Last'), rootItems[rootItems.length - 1]);
    outlinesDict.set(PDFName.of('Count'), PDFNumber.of(rootItems.length));
  }

  pdfDoc.catalog.set(PDFName.of('Outlines'), outlinesRef);
  return await pdfDoc.save();
}

function findPrevSibling(index: number, bookmarks: Bookmark[], refs: PDFRef[], context: any) {
  const currentLevel = bookmarks[index].level;
  for (let i = index - 1; i >= 0; i--) {
    if (bookmarks[i].level === currentLevel) {
      // Found a sibling
      return { ref: refs[i], dict: context.lookup(refs[i]) as PDFDict };
    }
    if (bookmarks[i].level < currentLevel) {
      // Reached parent level, no sibling before this one
      return null;
    }
  }
  return null;
}
