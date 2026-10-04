"use client";

import { useState } from "react";
import type { RefObject } from "react";
import { toPng } from "html-to-image";
import { domine } from "../app/fonts"; // ensures Domine is bundled

/**
 * Share / save controls that live in a corner of the main card. The exported
 * image is rendered from the card itself, so the controls are marked
 * data-export-ignore and filtered out of the capture; the watermark is then
 * drawn under the card on a canvas.
 */

type ShareButtonProps = {
  cardRef: RefObject<HTMLDivElement | null>;
  /** File name for the exported PNG */
  fileName?: string;
};

const EXPORT_IGNORE = "exportIgnore"; // data-export-ignore

export default function ShareButton({ cardRef, fileName = "trading-days.png" }: ShareButtonProps) {
  const [mode, setMode] = useState<null | "share" | "save">(null);
  const [error, setError] = useState<string | null>(null);

  const isWorking = mode !== null;

  const generateImage = async () => {
    if (!cardRef.current) {
      throw new Error("Card element not found");
    }

    const node = cardRef.current;

    // --- export-only style stripping for the entire subtree (keeps mobile clean) ---
    const patched = new Map<HTMLElement, string>();
    const elements = Array.from(node.querySelectorAll<HTMLElement>("*"));
    elements.unshift(node);

    const patchSubtree = () => {
      for (const el of elements) {
        patched.set(el, el.getAttribute("style") || "");

        el.style.border = "0";
        el.style.outline = "0";
        el.style.boxShadow = "none";
        el.style.filter = "none";
        el.style.setProperty("backdrop-filter", "none");
        el.style.transform = "none";
      }
    };

    const restoreSubtree = () => {
      for (const [el, style] of patched.entries()) {
        if (style) el.setAttribute("style", style);
        else el.removeAttribute("style");
      }
      patched.clear();
    };

    patchSubtree();

    try {
      // Sharper exports: bump pixelRatio more aggressively on mobile
      const isMobile =
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(max-width: 640px)").matches;

      const pixelRatio = isMobile ? 3 : 2;

      const dataUrl = await toPng(node, {
        cacheBust: true,
        backgroundColor: "#020617",
        pixelRatio,
        // The share/save controls themselves never appear in the image
        filter: (el) => !(el instanceof HTMLElement && el.dataset[EXPORT_IGNORE] !== undefined),
        style: {
          borderRadius: "0px",
          overflow: "hidden",
        },
      });

      const img = new Image();
      img.src = dataUrl;

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
      });

      const TARGET_ASPECT = 1.85; // width / height
      const footerSpace = 72;
      const topPadding = 28;
      const preferredScale = 1.08;

      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = Math.max(Math.round(canvas.width / TARGET_ASPECT), 200);

      const ctx = canvas.getContext("2d")!;
      if (!ctx) throw new Error("Canvas context not available");

      // Sharper downsampling / drawing (helps edges/text a bit)
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      ctx.fillStyle = "#020617";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const contentTop = topPadding;
      const contentBottom = canvas.height - footerSpace;
      const contentHeight = Math.max(0, contentBottom - contentTop);

      const fitScale = contentHeight / img.height;
      const scale = Math.min(preferredScale, fitScale);

      const drawW = Math.round(img.width * scale);
      const drawH = Math.round(img.height * scale);

      const dx = Math.round((canvas.width - drawW) / 2);
      const dy = Math.round(contentTop + (contentHeight - drawH) / 2) + 16;

      ctx.drawImage(img, dx, dy, drawW, drawH);

      // Watermark: smaller on mobile, keep desktop roughly the same
      // (mobile canvas width tends to be smaller -> this will reduce font size)
      const watermarkSize = Math.max(12, Math.min(18, Math.round(canvas.width / 55)));

      await document.fonts.load(`${watermarkSize}px Domine`);
      ctx.font = `${watermarkSize}px Domine`;
      ctx.fillStyle = "rgba(200, 200, 200, 0.6)";
      ctx.textAlign = "center";
      ctx.fillText("HowManyTradingDays.com", canvas.width / 2, canvas.height - 36);

      const finalDataUrl = canvas.toDataURL("image/png");

      const blob = await (await fetch(finalDataUrl)).blob();
      const file = new File([blob], fileName, { type: "image/png" });

      return { finalDataUrl, file };
    } finally {
      restoreSubtree();
    }
  };

  const handleShare = async () => {
    setMode("share");
    setError(null);

    try {
      const { finalDataUrl, file } = await generateImage();

      const shareData: ShareData = { files: [file] };

      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
        await navigator.share(shareData);
      } else {
        const link = document.createElement("a");
        link.href = finalDataUrl;
        link.download = fileName;
        link.click();
      }
    } catch (err: unknown) {
      const { name = "", message = "" } = (err ?? {}) as { name?: string; message?: string };

      const isUserCancel =
        name === "AbortError" ||
        name === "NotAllowedError" ||
        message?.toLowerCase()?.includes("abort") ||
        message?.toLowerCase()?.includes("cancel");

      if (isUserCancel) {
        setError(null);
      } else {
        console.error(err);
        setError("Couldn't export the image.");
      }
    } finally {
      setMode(null);
    }
  };

  const handleSave = async () => {
    setMode("save");
    setError(null);

    try {
      const { finalDataUrl } = await generateImage();

      const link = document.createElement("a");
      link.href = finalDataUrl;
      link.download = fileName;
      link.click();
    } catch (err) {
      console.error(err);
      setError("Couldn't save the image.");
    } finally {
      setMode(null);
    }
  };

  const buttonClass = `
    inline-flex h-7 w-7 items-center justify-center rounded-lg
    border border-slate-700/60 bg-slate-800/60 text-slate-400
    transition-colors duration-150
    hover:border-slate-600/60 hover:bg-slate-700/60 hover:text-white
    active:scale-[0.96]
    disabled:cursor-wait disabled:opacity-60
  `;

  const Spinner = (
    <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
    </svg>
  );

  return (
    <div
      data-export-ignore=""
      className="absolute right-2.5 top-2.5 sm:right-3 sm:top-3 flex items-center gap-1.5"
    >
      <button
        type="button"
        onClick={handleShare}
        disabled={isWorking}
        aria-busy={mode === "share"}
        aria-label="Share as image"
        title="Share as image"
        className={buttonClass}
      >
        {mode === "share" ? (
          Spinner
        ) : (
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.6" y1="13.4" x2="15.4" y2="6.6" />
            <line x1="8.6" y1="10.6" x2="15.4" y2="17.4" />
          </svg>
        )}
      </button>

      <button
        type="button"
        onClick={handleSave}
        disabled={isWorking}
        aria-busy={mode === "save"}
        aria-label="Save as image"
        title="Save as image"
        className={buttonClass}
      >
        {mode === "save" ? (
          Spinner
        ) : (
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4" />
          </svg>
        )}
      </button>

      {error && (
        <p
          role="alert"
          className="absolute right-0 top-9 whitespace-nowrap rounded-md border border-rose-400/40 bg-slate-950 px-2 py-1 text-[10px] text-rose-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
