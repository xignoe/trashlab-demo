// Driver photo thumbnail. Seed photoUrl values may be placeholders, so a load failure falls back to a tinted
// block carrying the file name rather than a broken image.
import { useState } from 'react';

export function PhotoThumb({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const fileName = url.split('/').pop() ?? url;
  if (failed) {
    return (
      <span className="thumb" title={`${alt} (${fileName})`} aria-label={alt}>
        {fileName}
      </span>
    );
  }
  return (
    <span className="thumb" title={alt}>
      <img src={url} alt={alt} onError={() => setFailed(true)} />
    </span>
  );
}
