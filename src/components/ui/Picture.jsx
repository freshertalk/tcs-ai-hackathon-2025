// src/components/ui/Picture.jsx
// <picture> wrapper that serves WebP with a JPEG fallback.
// Keeps width/height so the browser can reserve space (no layout shift).

import React from "react";

const base = process.env.PUBLIC_URL;

export default function Picture({
  name,          // e.g. "vinay-portrait" -> /vinay-portrait.webp + .jpg
  smallName,     // optional smaller variant for narrow viewports
  sizes,
  alt = "",
  width,
  height,
  className,
  loading = "lazy",
  fetchPriority,
  decoding = "async",
  ...rest
}) {
  const webpSet = smallName
    ? `${base}/${smallName}.webp 520w, ${base}/${name}.webp 1000w`
    : `${base}/${name}.webp`;
  const jpgSet = smallName
    ? `${base}/${smallName}.jpg 520w, ${base}/${name}.jpg 1000w`
    : `${base}/${name}.jpg`;

  return (
    <picture>
      <source type="image/webp" srcSet={webpSet} sizes={sizes} />
      <source type="image/jpeg" srcSet={jpgSet} sizes={sizes} />
      <img
        src={`${base}/${name}.jpg`}
        alt={alt}
        width={width}
        height={height}
        className={className}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding={decoding}
        {...rest}
      />
    </picture>
  );
}
