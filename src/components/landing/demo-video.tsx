"use client";

import { useRef, useState, useCallback } from "react";
import { Play, Pause, Maximize2, Volume2, VolumeX } from "lucide-react";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const VIDEO_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/public-assets/videos/demo.mp4`
  : null;

export function DemoVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [isMuted, setIsMuted] = useState(false);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => {
        // Browser blocked autoplay — state stays consistent via onPlay/onPause
      });
    } else {
      video.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  const goFullscreen = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.requestFullscreen) {
      video.requestFullscreen();
    } else if ("webkitEnterFullscreen" in video) {
      (video as HTMLVideoElement & { webkitEnterFullscreen(): void }).webkitEnterFullscreen();
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          goFullscreen();
          break;
      }
    },
    [togglePlay, toggleMute, goFullscreen],
  );

  if (!VIDEO_URL) return null;

  return (
    <div
      className="group relative overflow-hidden rounded-xl border border-border/50 bg-background shadow-2xl shadow-black/25"
      role="region"
      aria-label="Demo video player"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Browser chrome */}
      <div className="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-4 py-2" aria-hidden="true">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400/60" />
        </div>
        <div className="flex-1">
          <div className="mx-auto max-w-xs rounded-md bg-muted/60 px-3 py-0.5 text-center text-[11px] text-muted-foreground/60">
            vibecodes.co.uk
          </div>
        </div>
      </div>

      {/* Video container */}
      <div className="relative cursor-pointer" onClick={togglePlay}>
        <video
          ref={videoRef}
          className="w-full"
          src={VIDEO_URL}
          preload="metadata"
          playsInline
          aria-label="VibeCodes product demo walkthrough"
          onEnded={() => {
            setIsPlaying(false);
            setShowOverlay(true);
          }}
          onPause={() => setIsPlaying(false)}
          onPlay={() => {
            setIsPlaying(true);
            setShowOverlay(false);
          }}
          onVolumeChange={() => {
            if (videoRef.current) {
              setIsMuted(videoRef.current.muted);
            }
          }}
        />

        {/* Play overlay — stays mounted, animated via opacity */}
        <div
          className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity duration-300 ${
            showOverlay ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-hidden={!showOverlay}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/90 text-primary-foreground shadow-lg transition-transform motion-safe:hover:scale-110 sm:h-20 sm:w-20">
            <Play className="ml-1 h-7 w-7 sm:h-9 sm:w-9" aria-hidden="true" />
          </div>
        </div>

        {/* Hover controls */}
        {!showOverlay && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-4 py-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="flex min-h-10 min-w-10 items-center justify-center rounded-full p-1.5 text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
              aria-label={isPlaying ? "Pause video" : "Play video"}
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleMute();
              }}
              className="flex min-h-10 min-w-10 items-center justify-center rounded-full p-1.5 text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
              aria-label={isMuted ? "Unmute video" : "Mute video"}
            >
              {isMuted ? (
                <VolumeX className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Volume2 className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goFullscreen();
              }}
              className="flex min-h-10 min-w-10 items-center justify-center rounded-full p-1.5 text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
              aria-label="Enter fullscreen"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
