// Thin API client for the report-generation backend.

export async function getHealth() {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error('Health check failed');
  return res.json();
}

export async function generateReport(file, provider, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    if (provider) form.append('provider', provider);

    // XMLHttpRequest is used so we get real upload progress events.
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/generate');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      let payload;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        return reject(new Error('Server returned an unreadable response.'));
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
      else reject(new Error(payload.error || `Request failed (${xhr.status})`));
    };

    xhr.onerror = () => reject(new Error('Network error while uploading the report.'));
    xhr.send(form);
  });
}
