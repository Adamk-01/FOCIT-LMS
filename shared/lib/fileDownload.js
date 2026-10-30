/**
 * Secure Document Stream Downloader
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export async function downloadMaterialFile(material) {
  if (!material) return;
  if (material.type === 'url') {
    window.open(material.url, '_blank', 'noopener,noreferrer');
    return;
  }

  const url = material.url || `/api/files/${material.id}`;
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      ...(typeof sessionStorage !== 'undefined' && sessionStorage.getItem('session_nonce')
        ? { 'X-Session-Nonce': sessionStorage.getItem('session_nonce') }
        : {}),
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  const downloadName = material.filename || `${material.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  a.download = downloadName.endsWith('.pdf') ? downloadName : `${downloadName}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

export default downloadMaterialFile;
