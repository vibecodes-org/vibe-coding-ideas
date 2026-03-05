import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";
import { stripMarkdownForMeta } from "@/lib/utils";

export const runtime = "edge";
export const revalidate = 86400; // cache generated images for 24 hours
export const alt = "VibeCodes Idea";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data: idea } = await supabase
    .from("ideas")
    .select("title, description, visibility, author:users!ideas_author_id_fkey(full_name)")
    .eq("id", id)
    .single();

  // For private/not-found ideas, render default branded image
  if (!idea || idea.visibility === "private") {
    return renderDefault();
  }

  const authorName = (idea.author as unknown as { full_name: string | null })?.full_name ?? "VibeCodes User";
  const description = idea.description
    ? stripMarkdownForMeta(idea.description, 120)
    : "";

  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #09090b 0%, #18181b 50%, #09090b 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
          padding: "60px 80px",
        }}
      >
        {/* Background glow effects */}
        <div
          style={{
            position: "absolute",
            top: "10%",
            left: "15%",
            width: "400px",
            height: "400px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "10%",
            right: "15%",
            width: "350px",
            height: "350px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(168,85,247,0.1) 0%, transparent 70%)",
          }}
        />

        {/* Content */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", zIndex: 1 }}>
          <div
            style={{
              fontSize: "52px",
              fontWeight: 800,
              color: "white",
              letterSpacing: "-1px",
              lineHeight: 1.15,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {idea.title}
          </div>
          {description && (
            <div
              style={{
                fontSize: "24px",
                color: "#a1a1aa",
                lineHeight: 1.4,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {description}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ fontSize: "20px", color: "#71717a" }}>by {authorName}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path
                d="M16 4l1.5 5.5L23 11l-5.5 1.5L16 18l-1.5-5.5L9 11l5.5-1.5L16 4z"
                fill="white"
              />
              <path
                d="M24 16l1 3.5 3.5 1-3.5 1-1 3.5-1-3.5L19.5 20.5l3.5-1L24 16z"
                fill="white"
                opacity="0.7"
              />
            </svg>
            <div style={{ fontSize: "24px", fontWeight: 700, color: "white" }}>VibeCodes</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

function renderDefault() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #09090b 0%, #18181b 50%, #09090b 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "10%",
            left: "15%",
            width: "400px",
            height: "400px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "10%",
            right: "15%",
            width: "350px",
            height: "350px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(168,85,247,0.1) 0%, transparent 70%)",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "24px" }}>
          <svg width="64" height="64" viewBox="0 0 32 32" fill="none">
            <path d="M16 4l1.5 5.5L23 11l-5.5 1.5L16 18l-1.5-5.5L9 11l5.5-1.5L16 4z" fill="white" />
            <path d="M24 16l1 3.5 3.5 1-3.5 1-1 3.5-1-3.5L19.5 20.5l3.5-1L24 16z" fill="white" opacity="0.7" />
            <path d="M10 18l0.75 2.5L13.25 21.25l-2.5 0.75L10 24.5l-0.75-2.5L6.75 21.25l2.5-0.75L10 18z" fill="white" opacity="0.5" />
          </svg>
        </div>
        <div style={{ fontSize: "72px", fontWeight: 800, color: "white", letterSpacing: "-2px", marginBottom: "16px" }}>
          VibeCodes
        </div>
        <div style={{ fontSize: "28px", color: "#a1a1aa", maxWidth: "700px", textAlign: "center", lineHeight: "1.4" }}>
          Where vibe coding ideas come to life
        </div>
      </div>
    ),
    { ...size },
  );
}
