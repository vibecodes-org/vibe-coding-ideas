import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "VibeCodes - AI-Powered Idea Board for Vibe Coding";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vibecodes.co.uk";

  // Fetch the hero screenshot for embedding
  let heroSrc: ArrayBuffer | null = null;
  try {
    heroSrc = await fetch(new URL("/og-hero.png", appUrl)).then((r) =>
      r.arrayBuffer()
    );
  } catch {
    // Fallback: render without screenshot
  }

  return new ImageResponse(
    (
      <div
        style={{
          background:
            "linear-gradient(135deg, #09090b 0%, #18181b 50%, #09090b 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
          padding: "50px 60px",
        }}
      >
        {/* Background glow effects */}
        <div
          style={{
            position: "absolute",
            top: "5%",
            left: "5%",
            width: "400px",
            height: "400px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "5%",
            right: "10%",
            width: "350px",
            height: "350px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(168,85,247,0.1) 0%, transparent 70%)",
          }}
        />

        {/* Left column: branding */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: "0 0 420px",
            zIndex: 1,
          }}
        >
          {/* Sparkles icon */}
          <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
            <path
              d="M16 4l1.5 5.5L23 11l-5.5 1.5L16 18l-1.5-5.5L9 11l5.5-1.5L16 4z"
              fill="white"
            />
            <path
              d="M24 16l1 3.5 3.5 1-3.5 1-1 3.5-1-3.5L19.5 20.5l3.5-1L24 16z"
              fill="white"
              opacity="0.7"
            />
            <path
              d="M10 18l0.75 2.5L13.25 21.25l-2.5 0.75L10 24.5l-0.75-2.5L6.75 21.25l2.5-0.75L10 18z"
              fill="white"
              opacity="0.5"
            />
          </svg>

          {/* Title */}
          <div
            style={{
              fontSize: "52px",
              fontWeight: 800,
              color: "white",
              letterSpacing: "-2px",
              marginTop: "16px",
            }}
          >
            VibeCodes
          </div>

          {/* Tagline */}
          <div
            style={{
              fontSize: "22px",
              color: "#a1a1aa",
              lineHeight: "1.4",
              marginTop: "8px",
            }}
          >
            Where vibe coding ideas come to life
          </div>

          {/* Pill badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginTop: "24px",
              padding: "8px 16px",
              borderRadius: "9999px",
              border: "1px solid rgba(139,92,246,0.4)",
              background: "rgba(139,92,246,0.1)",
              width: "fit-content",
            }}
          >
            <div style={{ fontSize: "14px", color: "#a78bfa" }}>
              Idea to shipped code, powered by AI
            </div>
          </div>
        </div>

        {/* Right column: screenshot in browser frame */}
        {heroSrc && (
          <div
            style={{
              flex: 1,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              marginLeft: "30px",
              zIndex: 1,
            }}
          >
            {/* Shadow wrapper — Satori doesn't support box-shadow */}
            <div
              style={{
                borderRadius: "12px",
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              {/* Browser chrome bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "10px 14px",
                  background: "rgba(255,255,255,0.06)",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: "#f87171",
                  }}
                />
                <div
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: "#fbbf24",
                  }}
                />
                <div
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: "#4ade80",
                  }}
                />
                <div
                  style={{
                    flex: 1,
                    textAlign: "center",
                    fontSize: "11px",
                    color: "rgba(255,255,255,0.3)",
                  }}
                >
                  vibecodes.co.uk
                </div>
              </div>
              {/* Screenshot */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroSrc as unknown as string}
                width={620}
                height={348}
                style={{ display: "block" }}
                alt=""
              />
            </div>
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}
