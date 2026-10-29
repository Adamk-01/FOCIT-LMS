import { pool } from '../db/index.js';

async function run() {
  const svgContent = `
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800" style="background:#fbfaf8; font-family:sans-serif;">
  <rect x="15" y="15" width="570" height="770" fill="#ffffff" stroke="#d1d5db" stroke-width="2" rx="8"/>
  <text x="300" y="60" text-anchor="middle" font-size="20" font-weight="bold" fill="#0a1142">OSUN STATE UNIVERSITY</text>
  <text x="300" y="85" text-anchor="middle" font-size="13" font-weight="600" fill="#4b5563">FACULTY OF COMPUTING &amp; INFORMATION TECHNOLOGY</text>
  <rect x="150" y="105" width="300" height="28" rx="6" fill="#0a1142"/>
  <text x="300" y="124" text-anchor="middle" font-size="11" font-weight="bold" fill="#ffb81c">OFFICIAL ATTENDANCE REGISTER (MODE 4)</text>
  <line x1="40" y1="150" x2="560" y2="150" stroke="#e5e7eb" stroke-width="1.5"/>
  <text x="50" y="175" font-size="12" fill="#4b5563">Course: <tspan font-weight="bold" fill="#111827">CSC 204</tspan></text>
  <text x="260" y="175" font-size="12" fill="#4b5563">Week: <tspan font-weight="bold" fill="#111827">1</tspan></text>
  <text x="400" y="175" font-size="12" fill="#4b5563">Mode: <tspan font-weight="bold" fill="#059669">PHYSICAL SHEET SCAN</tspan></text>
  <line x1="40" y1="195" x2="560" y2="195" stroke="#111827" stroke-width="2"/>
  <rect x="40" y="205" width="520" height="30" fill="#f3f4f6"/>
  <text x="55" y="225" font-size="11" font-weight="bold" fill="#374151">#</text>
  <text x="90" y="225" font-size="11" font-weight="bold" fill="#374151">MATRICULATION NO</text>
  <text x="280" y="225" font-size="11" font-weight="bold" fill="#374151">SIGNATURE</text>
  <text x="470" y="225" font-size="11" font-weight="bold" fill="#374151">STATUS</text>
  <line x1="40" y1="270" x2="560" y2="270" stroke="#e5e7eb"/>
  <text x="55" y="258" font-size="11" fill="#6b7280">1</text>
  <text x="90" y="258" font-size="11" font-weight="bold" font-family="monospace" fill="#111827">2021/CSC/001</text>
  <text x="280" y="258" font-size="13" font-style="italic" font-family="serif" fill="#1e40af">J. Doe</text>
  <rect x="460" y="245" width="65" height="18" rx="4" fill="#d1fae5"/>
  <text x="492" y="258" text-anchor="middle" font-size="10" font-weight="bold" fill="#065f46">PRESENT</text>
  <line x1="40" y1="310" x2="560" y2="310" stroke="#e5e7eb"/>
  <text x="55" y="298" font-size="11" fill="#6b7280">2</text>
  <text x="90" y="298" font-size="11" font-weight="bold" font-family="monospace" fill="#111827">2021/CSC/002</text>
  <text x="280" y="298" font-size="11" fill="#9ca3af">--</text>
  <rect x="460" y="285" width="65" height="18" rx="4" fill="#fee2e2"/>
  <text x="492" y="298" text-anchor="middle" font-size="10" font-weight="bold" fill="#991b1b">ABSENT</text>
  <line x1="40" y1="350" x2="560" y2="350" stroke="#e5e7eb"/>
  <text x="55" y="338" font-size="11" fill="#6b7280">3</text>
  <text x="90" y="338" font-size="11" font-weight="bold" font-family="monospace" fill="#111827">FOCIT/2026/47230</text>
  <text x="280" y="338" font-size="11" fill="#9ca3af">--</text>
  <rect x="460" y="325" width="65" height="18" rx="4" fill="#fee2e2"/>
  <text x="492" y="338" text-anchor="middle" font-size="10" font-weight="bold" fill="#991b1b">ABSENT</text>
  <line x1="40" y1="720" x2="560" y2="720" stroke="#111827" stroke-width="1.5"/>
  <text x="50" y="745" font-size="10" fill="#6b7280">COURSE REP INGESTION: <tspan font-weight="bold" fill="#059669">OCR VERIFIED</tspan></text>
  <text x="420" y="745" font-size="10" fill="#6b7280">DEANERY REGISTRY: #FOCIT-2026</text>
</svg>
`.trim();

  const svgDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`;

  await pool.query(
    `UPDATE attendance_sessions SET sheet_image_urls = $1 WHERE course_id = 'CSC204'`,
    [JSON.stringify([svgDataUri])]
  );
  console.log('Updated attendance_sessions sheet_image_urls with SVG Data URI!');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
