// Unsigned browser-direct upload to Cloudinary.
// Cloud name and preset are non-secret; no API key or signature needed.
const CLOUD = 'domztu6qv';
const PRESET = 'gsoc-monitor';
const ENDPOINT = `https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`;

export async function uploadImage(dataUrl: string): Promise<string> {
  const fd = new FormData();
  fd.append('file', dataUrl);
  fd.append('upload_preset', PRESET);
  const res = await fetch(ENDPOINT, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Cloudinary upload failed: ${res.status}`);
  const json = await res.json() as { secure_url: string };
  return json.secure_url;
}
