"use client";

import { useRef } from "react";
import type { ReactNode } from "react";
import ShareButton from "./ShareButton";

/**
 * A card that can be shared or saved as an image. Mounts the same share/save
 * controls as the homepage countdown in its top-right corner; the export
 * (with the site-name watermark) is rendered from this element.
 */
type Props = {
  className?: string;
  /** File name for the exported PNG */
  fileName?: string;
  children: ReactNode;
};

export default function ShareableCard({ className = "", fileName, children }: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  return (
    <section ref={cardRef} className={`relative ${className}`}>
      <ShareButton cardRef={cardRef} fileName={fileName} />
      {children}
    </section>
  );
}
