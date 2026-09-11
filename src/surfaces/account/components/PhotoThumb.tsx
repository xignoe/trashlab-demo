// Driver photo thumbnail. Seed photoUrl values may be placeholders, so a load failure falls back to a tinted
// block carrying the file name rather than a broken image.
import { useState } from 'react';
import { resolvePhoto } from '../../../seed';

export function PhotoThumb({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  // Seed photoUrl values name files under /evidence or photos/; resolvePhoto maps them to public/photos (absolute /photos/).
  const src = resolvePhoto(url);
  const fileName = url.split('/').pop() ?? url;
  if (failed || !src) {
    return (
      <span className="thumb" title={`${alt} (${fileName})`} aria-label={alt}>
        {fileName}
      </span>
    );
  }
  return (
    <span className="thumb" title={alt}>
      <img src={src} alt={alt} onError={() => setFailed(true)} />
    </span>
  );
}
