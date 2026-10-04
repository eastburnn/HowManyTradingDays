"use client";

import { useRef } from "react";
import type { ReactNode } from "react";
import ShareButton from "./ShareButton";

/**
 * A card that can be shared or saved as an image. Mounts the same share/save
 * controls as the homepage countdown in its top-right corner; the export
 * (with the site-name watermark) is rendered from this element.
 *
 * The wrapper is a container-query root: the card's responsive classes use
 * `@lg:` (card width, not viewport width), so the export can render the
 * desktop layout on any device by widening this element for the capture.
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
    <div ref={cardRef} className="@container w-full">
      <section className={`relative ${className}`}>
        <ShareButton cardRef={cardRef} fileName={fileName} />
        {children}
      </section>
    </div>
  );
}
