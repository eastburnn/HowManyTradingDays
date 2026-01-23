"use client";

import { useState } from "react";
import type { RefObject } from "react";
import { toPng } from "html-to-image";
import { domine } from "../app/fonts"; // ensures Domine is bundled

type ShareButtonProps = {
  cardRef: RefObject<HTMLDivElement | null>;
};

export default function ShareButton({ cardRef }: ShareButtonProps) {
  const [mode, setMode] = useState<null | "share" | "save">(null);
  const [error, setError] = useState<string | null>(null);

  const isWorking = mode !== null;

  // Shared function to generate the final watermarked PNG
  const generateImage = async () => {
    if (!cardRef.current) {
      throw new Error("Card element not found");
    }

    const node = cardRef.current;

    // Capture the card as it appears (but remove its border for export)
    const dataUrl = await toPng(node, {
      cacheBust: true,
      backgroundColor: "#020617", // Tailwind slate-950
      pixelRatio: 2,
      style: {
        // ensure exported image is rectangular even if card has rounded corners
        borderRadius: "0px",
        overflow: "hidden",

        // IMPORTANT: prevent the card's own border from looking odd when we pad/scale
        border: "none",
        boxShadow: "none",
      },
    });

    // Load into an Image so we can draw to canvas
    const img = new Image();
    img.src = dataUrl;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
    });

    /**
     * EXPORT TUNING (DEVICE-INDEPENDENT)
     * Force a single aspect ratio for the final exported image, regardless of device.
     */
    const TARGET_ASPECT = 1.85; // width / height (higher = more rectangular/shorter)
    const footerSpace = 72; // reserved space at bottom for watermark breathing room
    const topPadding = 28; // keeps content from hugging top
    const preferredScale = 1.08; // make content slightly larger in export

    const canvas = document.createElement("canvas");
    canvas.width = img.width;

    // Force the same export aspect ratio everywhere
    const targetHeight = Math.round(canvas.width / TARGET_ASPECT);
    canvas.height = Math.max(targetHeight, 200); // safety floor

    const ctx = canvas.getContext("2d")!;
    if (!ctx) throw new Error("Canvas context not available");

    // Background
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Compute the drawable area for the card (exclude footer space)
    const contentTop = topPadding;
    const contentBottom = canvas.height - footerSpace;
    const contentHeight = Math.max(0, contentBottom - contentTop);

    // Scale to fit content area (keeps consistent composition even if mobile capture is tall)
    const fitScale = contentHeight / img.height;
    const scale = Math.min(preferredScale, fitScale);

    // Draw with integer coords + slight bleed to avoid edge artifacts (mobile side gray lines)
    const bleed = 3; // px
    const drawW = Math.round(img.width * scale);
    const drawH = Math.round(img.height * scale);

    const dx = Math.round((canvas.width - drawW) / 2) - bleed;
    const dy = Math.round(contentTop + (contentHeight - drawH) / 2) - bleed;

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, dx, dy, drawW + bleed * 2, drawH + bleed * 2);

    // Watermark: slightly smaller on mobile by scaling with canvas width
    const watermarkSize = Math.max(14, Math.min(18, Math.round(canvas.width / 45)));

    await document.fonts.load(`${watermarkSize}px Domine`);
    ctx.font = `${watermarkSize}px Domine`;
    ctx.fillStyle = "rgba(200, 200, 200, 0.6)";
    ctx.textAlign = "center";
    ctx.fillText("HowManyTradingDays.com", canvas.width / 2, canvas.height - 36);

    const finalDataUrl = canvas.toDataURL("image/png");

    const blob = await (await fetch(finalDataUrl)).blob();
    const file = new File([blob], "trading-days.png", {
      type: "image/png",
    });

    return { finalDataUrl, file };
  };

  const handleShare = async () => {
    setMode("share");
    setError(null);

    try {
      const { finalDataUrl, file } = await generateImage();

      const shareData: ShareData = {
        files: [file],
      };

      const navAny = navigator as any;

      if (
        navigator.share &&
        (!navAny.canShare || navAny.canShare({ files: [file] }))
      ) {
        await navigator.share(shareData);
      } else {
        // Fallback: download if share not supported
        const link = document.createElement("a");
        link.href = finalDataUrl;
        link.download = "trading-days.png";
        link.click();
      }
    } catch (err: any) {
      const name = err?.name || "";
      const message = err?.message || "";

      const isUserCancel =
        name === "AbortError" ||
        name === "NotAllowedError" ||
        message?.toLowerCase()?.includes("abort") ||
        message?.toLowerCase()?.includes("cancel");

      if (isUserCancel) {
        console.log("Share cancelled by user");
        setError(null);
      } else {
        console.error(err);
        setError("Something went wrong exporting the image.");
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
      link.download = "trading-days.png";
      link.click();
    } catch (err) {
      console.error(err);
      setError("Something went wrong saving the image.");
    } finally {
      setMode(null);
    }
  };

  return (
    <div className="w-full flex flex-col items-center gap-1">
      {/* Buttons row */}
      <div className="flex items-center gap-2">
        {/* SHARE BUTTON */}
        <button
          onClick={handleShare}
          disabled={isWorking}
          className={`
            group relative inline-flex items-center gap-2
            rounded-xl px-4 py-2 text-xs font-medium
            bg-slate-800/60 text-slate-200 shadow-sm backdrop-blur
            border border-slate-700/60
            transition-all duration-200
            hover:bg-slate-700/60 hover:border-slate-600/60 hover:shadow-md
            active:scale-[0.97]
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        >
          <span className="transition-opacity duration-150 group-hover:opacity-90">
            {mode === "share" ? "Preparing..." : "Share"}
          </span>

          {/* Share icon */}
          <svg
            className="w-4 h-4 text-slate-300 group-hover:text-white transition"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.6" y1="13.4" x2="15.4" y2="6.6" />
            <line x1="8.6" y1="10.6" x2="15.4" y2="17.4" />
          </svg>

          <span className="absolute inset-0 rounded-xl bg-slate-400/10 opacity-0 group-hover:opacity-100 transition pointer-events-none" />
        </button>

        {/* SAVE BUTTON */}
        <button
          onClick={handleSave}
          disabled={isWorking}
          className={`
            group relative inline-flex items-center gap-2
            rounded-xl px-4 py-2 text-xs font-medium
            bg-slate-800/60 text-slate-200 shadow-sm backdrop-blur
            border border-slate-700/60
            transition-all duration-200
            hover:bg-slate-700/60 hover:border-slate-600/60 hover:shadow-md
            active:scale-[0.97]
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        >
          <span className="transition-opacity duration-150 group-hover:opacity-90">
            {mode === "save" ? "Preparing..." : "Save"}
          </span>

          {/* Download icon */}
          <svg
            className="w-4 h-4 text-slate-300 group-hover:text-white transition"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 3v12m0 0l-4-4m4 4l4-4"
            />
          </svg>

          <span className="absolute inset-0 rounded-xl bg-slate-400/10 opacity-0 group-hover:opacity-100 transition pointer-events-none" />
        </button>
      </div>

      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
