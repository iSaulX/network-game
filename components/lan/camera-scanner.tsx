"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DrawablyButton } from "drawably/react";
import type { PairingFailure } from "@/lib/party/webrtc/pairing";

/**
 * Optional camera scanner for pairing codes.
 *
 * The camera only starts on an explicit tap, stops the moment a code is read,
 * and every failure falls back to the paste field the parent always shows.
 * `BarcodeDetector` is preferred; `jsqr` is loaded on demand elsewhere.
 */
export interface CameraScannerProps {
  onPart(part: string): void;
  onFailure(failure: PairingFailure): void;
}

type DetectorLike = {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
};

type BarcodeDetectorConstructor = new (options: {
  formats: string[];
}) => DetectorLike;

const SCAN_INTERVAL_MS = 250;
const COOLDOWN_MS = 1200;

export function CameraScanner({ onPart, onFailure }: CameraScannerProps) {
  const [active, setActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastValueRef = useRef<{ value: string; at: number } | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setActive(false);
  }, []);

  useEffect(() => stop, [stop]);

  const deliver = useCallback(
    (value: string) => {
      const now = Date.now();
      const last = lastValueRef.current;
      // The same QR stays in frame for many frames; report it once.
      if (last && last.value === value && now - last.at < COOLDOWN_MS) {
        return;
      }
      lastValueRef.current = { value, at: now };
      onPart(value.trim());
    },
    [onPart],
  );

  const start = useCallback(async () => {
    if (active) {
      stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      onFailure("camera-missing");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setActive(true);
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
    } catch (error) {
      const name = (error as { name?: string }).name;
      onFailure(name === "NotFoundError" ? "camera-missing" : "camera-denied");
    }
  }, [active, onFailure, stop]);

  // Scanning loop, re-created whenever the camera starts.
  useEffect(() => {
    if (!active) return;

    const Detector = (
      globalThis as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }
    ).BarcodeDetector;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    let detector: DetectorLike | null = null;
    if (Detector) {
      detector = new Detector({ formats: ["qr_code"] });
    }

    const context = canvas.getContext("2d", { willReadFrequently: true });

    const tick = async () => {
      if (video.readyState < 2 || video.videoWidth === 0) return;

      if (detector) {
        try {
          const found = await detector.detect(video);
          const raw = found[0]?.rawValue;
          if (raw) deliver(raw);
        } catch {
          // A failed frame is not fatal; keep the camera running.
        }
        return;
      }

      if (!context) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);

      try {
        const { default: jsQR } = await import("jsqr");
        const found = jsQR(image.data, image.width, image.height, {
          inversionAttempts: "dontInvert",
        });
        if (found?.data) deliver(found.data);
      } catch {
        // Keep scanning.
      }
    };

    timerRef.current = window.setInterval(() => {
      void tick();
    }, SCAN_INTERVAL_MS);

    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [active, deliver]);

  return (
    <div className="flex flex-col items-center gap-3">
      <DrawablyButton
        type="button"
        variant={active ? "solid" : "outline"}
        onClick={() => void start()}
        className="select-none px-4 py-2 text-sm"
      >
        {active ? "Detener cámara" : "Activar cámara"}
      </DrawablyButton>

      <div className="relative w-full max-w-xs overflow-hidden rounded-xl bg-stone-900/90">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label="Vista de la cámara para escanear el código"
          className={`aspect-square w-full object-cover ${active ? "" : "hidden"}`}
        />
        <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
      </div>

      {active && (
        <p aria-live="polite" className="text-xs text-stone-500">
          Apunta al código del otro dispositivo.
        </p>
      )}
    </div>
  );
}
