/**
 * Genuine Multi-Page PDF Binary Generator
 * Generates syntactically conformant PDF-1.4 binaries with valid xref tables,
 * page trees, and font dictionaries for byte-range slice testing.
 */

export function generateValidMultiPagePdf({ title = 'FOCIT LMS Academic Document', author = 'Faculty of Computing', pagesCount = 3, courseCode = 'CSC 201' } = {}) {
  const objects = [];
  const byteOffsets = [];
  let buffer = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';

  function recordObject(content) {
    const objNum = objects.length + 1;
    const offset = Buffer.byteLength(buffer, 'latin1');
    byteOffsets.push(offset);
    const objStr = `${objNum} 0 obj\n${content}\nendobj\n`;
    buffer += objStr;
    objects.push(objNum);
    return objNum;
  }

  // Obj 1: Catalog (Placeholder, will be assigned after page tree)
  // Let's create font object first
  // Obj 1: Font
  const fontObj = recordObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  // We need page objects and content stream objects
  const pageObjectIds = [];
  const contentObjectIds = [];

  for (let i = 1; i <= pagesCount; i++) {
    const textStream = `BT
/F1 20 Tf
50 720 Td
(${escapePdfText(title)}) Tj
0 -30 Td
/F1 12 Tf
(Faculty of Computing & Information Technology - Osun State University) Tj
0 -20 Td
(Course: ${escapePdfText(courseCode)} | Author: ${escapePdfText(author)}) Tj
0 -25 Td
(Official Academic Vault Document - Page ${i} of ${pagesCount}) Tj
0 -30 Td
(Verified by FOCIT LMS Deanery & Departmental Board of Examiners) Tj
0 -20 Td
(This digital material is watermarked and authorized for authenticated student study.) Tj
ET`;
    const streamLength = Buffer.byteLength(textStream, 'latin1');
    const contentObj = recordObject(`<< /Length ${streamLength} >>\nstream\n${textStream}\nendstream`);
    contentObjectIds.push(contentObj);
  }

  // Now create the Page objects
  // We need Pages object ID beforehand. It will be created next.
  const pagesTreeObjId = objects.length + pagesCount + 1;

  for (let i = 0; i < pagesCount; i++) {
    const pageObj = recordObject(`<< /Type /Page /Parent ${pagesTreeObjId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentObjectIds[i]} 0 R >>`);
    pageObjectIds.push(pageObj);
  }

  // Now record Pages tree object
  const kidsStr = pageObjectIds.map(id => `${id} 0 R`).join(' ');
  const actualPagesTreeObjId = recordObject(`<< /Type /Pages /Kids [${kidsStr}] /Count ${pagesCount} >>`);

  // Now record Catalog object
  const catalogObjId = recordObject(`<< /Type /Catalog /Pages ${actualPagesTreeObjId} 0 R >>`);

  // xref table
  const xrefOffset = Buffer.byteLength(buffer, 'latin1');
  const totalObjects = objects.length + 1; // including 0
  let xref = `xref\n0 ${totalObjects}\n0000000000 65535 f \n`;

  for (let i = 0; i < objects.length; i++) {
    const offsetStr = String(byteOffsets[i]).padStart(10, '0');
    xref += `${offsetStr} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${totalObjects} /Root ${catalogObjId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  buffer += xref + trailer;

  return Buffer.from(buffer, 'latin1');
}

function escapePdfText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
