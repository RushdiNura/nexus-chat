import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Download, ExternalLink, X } from "lucide-react";

/** Full-screen image preview shared by direct and group conversations. */
export default function MediaLightbox({ image, onClose }) {
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!image?.src) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [image?.src]);

  if (!image?.src || typeof document === "undefined") return null;

  const fileName = image.fileName || "nexuschat-image";
  return createPortal(
    <div
      className="nexus-media-viewer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeRef.current?.();
      }}
      onTouchMove={(event) => event.stopPropagation()}
    >
      <section className="nexus-media-viewer__panel" role="dialog" aria-modal="true" aria-label="Image preview">
        <header className="nexus-media-viewer__toolbar">
          <div className="nexus-media-viewer__heading">
            <strong>{image.alt || "Shared image"}</strong>
            <span>Image preview</span>
          </div>
          <div className="nexus-media-viewer__actions">
            <a href={image.src} download={fileName} target="_blank" rel="noreferrer" aria-label="Download or save image" title="Save image">
              <Download size={17} aria-hidden="true" />
            </a>
            <a href={image.src} target="_blank" rel="noreferrer" aria-label="Open original image in a new tab" title="Open original">
              <ExternalLink size={17} aria-hidden="true" />
            </a>
            <button type="button" onClick={() => closeRef.current?.()} aria-label="Close image preview" title="Close preview">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="nexus-media-viewer__canvas">
          <img src={image.src} alt={image.alt || "Shared image"} draggable="false" />
        </div>
      </section>
    </div>,
    document.body,
  );
}
