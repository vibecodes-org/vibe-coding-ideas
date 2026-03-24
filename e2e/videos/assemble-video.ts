/**
 * Post-processing script: assembles raw Playwright WebM recordings into
 * a single MP4 demo video with text annotations via ffmpeg.
 *
 * Usage: npx tsx e2e/videos/assemble-video.ts
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEST_RESULTS_DIR = path.resolve(__dirname, "../../test-results");
const OUTPUT_DIR = path.resolve(__dirname, "../../videos");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "demo.mp4");

// Resolve ffmpeg binary — check PATH first, then common winget install location
function findFfmpeg(): string {
  try {
    execSync("ffmpeg -version", { stdio: "pipe" });
    return "ffmpeg";
  } catch {
    // Not on PATH — check winget install location
    const wingetBase = path.join(
      process.env.LOCALAPPDATA || "",
      "Microsoft/WinGet/Packages"
    );
    if (fs.existsSync(wingetBase)) {
      const entries = fs.readdirSync(wingetBase);
      for (const entry of entries) {
        if (entry.toLowerCase().includes("ffmpeg")) {
          const binDir = path.join(wingetBase, entry);
          // Search recursively for ffmpeg.exe
          const found = findFileRecursive(binDir, "ffmpeg.exe", 3);
          if (found) return `"${found}"`;
        }
      }
    }
    throw new Error(
      "ffmpeg not found. Install with: winget install ffmpeg\n" +
      "Then restart your terminal or add ffmpeg to PATH."
    );
  }
}

function findFileRecursive(dir: string, name: string, maxDepth: number): string | null {
  if (maxDepth <= 0) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        const found = findFileRecursive(fullPath, name, maxDepth - 1);
        if (found) return found;
      }
    }
  } catch { /* permission errors */ }
  return null;
}

function findFfprobe(ffmpegPath: string): string {
  // ffprobe is in the same directory as ffmpeg
  const dir = path.dirname(ffmpegPath.replace(/"/g, ""));
  const ffprobe = path.join(dir, "ffprobe.exe");
  if (fs.existsSync(ffprobe)) return `"${ffprobe}"`;
  const ffprobeNoExt = path.join(dir, "ffprobe");
  if (fs.existsSync(ffprobeNoExt)) return `"${ffprobeNoExt}"`;
  return "ffprobe"; // fallback to PATH
}

// Scene annotations — text overlaid at bottom-center
const SCENE_ANNOTATIONS: Record<string, { text: string; start: number; end: number }> = {
  "scene-1": {
    text: "VibeCodes — AI-Powered Idea Board",
    start: 2,
    end: 6,
  },
  "scene-2": {
    text: "AI enhances your idea description",
    start: 2,
    end: 6,
  },
  "scene-3": {
    text: "AI generates a full task board from your idea",
    start: 1,
    end: 5,
  },
  "scene-4": {
    text: "Full project management — drag-and-drop, labels, checklists",
    start: 1,
    end: 5,
  },
  "scene-5": {
    text: "AI agents join your team as first-class members",
    start: 1,
    end: 5,
  },
  "scene-6": {
    text: "vibecodes.co.uk — Get Started Free",
    start: 2,
    end: 8,
  },
};

function findSceneVideos(): { scene: string; videoPath: string }[] {
  if (!fs.existsSync(TEST_RESULTS_DIR)) {
    throw new Error(
      `test-results/ directory not found. Run 'npm run demo:record' first.`
    );
  }

  const scenes: { scene: string; videoPath: string }[] = [];

  // Playwright stores videos in test-results/<test-name>/video.webm
  // The directory names match the test names from record-demo.ts
  const entries = fs.readdirSync(TEST_RESULTS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // Match directories like "record-demo.ts-scene-1-dashboard", "record-demo.ts-scene-2-create-idea"
    const sceneMatch = entry.name.match(/(scene-\d+)/);
    if (!sceneMatch) continue;

    const sceneName = sceneMatch[1];

    // Look for video file (WebM) inside the directory
    const sceneDir = path.join(TEST_RESULTS_DIR, entry.name);
    const videoFile = findVideoFile(sceneDir);

    if (videoFile) {
      scenes.push({ scene: sceneName, videoPath: videoFile });
    }
  }

  // Sort by scene number
  scenes.sort((a, b) => {
    const numA = parseInt(a.scene.replace("scene-", ""), 10);
    const numB = parseInt(b.scene.replace("scene-", ""), 10);
    return numA - numB;
  });

  return scenes;
}

function findVideoFile(dir: string): string | null {
  const files = fs.readdirSync(dir, { recursive: true }) as string[];
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (file.endsWith(".webm") && fs.statSync(filePath).isFile()) {
      return filePath;
    }
  }
  return null;
}

function annotateScene(
  ffmpeg: string,
  inputPath: string,
  outputPath: string,
  annotation: { text: string; start: number; end: number }
) {
  // Escape special characters for ffmpeg drawtext
  const escapedText = annotation.text
    .replace(/\\/g, "\\\\\\\\")
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, "\\\\:");

  const drawtext = [
    `drawtext=text='${escapedText}'`,
    "fontsize=28",
    "fontcolor=white",
    "box=1",
    "boxcolor=black@0.7",
    "boxborderw=12",
    "x=(w-text_w)/2",
    "y=h-80",
    `enable='between(t,${annotation.start},${annotation.end})'`,
  ].join(":");

  const cmd = [
    ffmpeg,
    "-y",
    "-i",
    `"${inputPath}"`,
    "-vf",
    `"${drawtext}"`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-an", // no audio from screen recordings
    `"${outputPath}"`,
  ].join(" ");

  console.log(`  Annotating: ${path.basename(inputPath)}`);
  execSync(cmd, { stdio: "pipe" });
}

function concatenateVideos(ffmpeg: string, inputPaths: string[], outputPath: string) {
  // Create a concat list file
  const listFile = path.join(OUTPUT_DIR, "concat-list.txt");
  const listContent = inputPaths
    .map((p) => `file '${p.replace(/\\/g, "/")}'`)
    .join("\n");
  fs.writeFileSync(listFile, listContent);

  const cmd = [
    ffmpeg,
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    `"${listFile}"`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    `"${outputPath}"`,
  ].join(" ");

  console.log("\nConcatenating scenes...");
  execSync(cmd, { stdio: "pipe" });

  // Clean up
  fs.unlinkSync(listFile);
}

async function main() {
  console.log("=== VibeCodes Demo Video Assembly ===\n");

  // 0. Resolve ffmpeg binary
  const ffmpeg = findFfmpeg();
  console.log(`Using ffmpeg: ${ffmpeg}\n`);

  // 1. Find scene videos
  const scenes = findSceneVideos();
  if (scenes.length === 0) {
    console.error(
      "No scene videos found in test-results/.\n" +
        "Run 'npm run demo:record' first."
    );
    process.exit(1);
  }
  console.log(`Found ${scenes.length} scene(s):`);
  for (const s of scenes) {
    console.log(`  ${s.scene}: ${path.basename(s.videoPath)}`);
  }

  // 2. Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 3. Annotate each scene
  console.log("\nAnnotating scenes...");
  const annotatedPaths: string[] = [];

  for (const { scene, videoPath } of scenes) {
    const annotation = SCENE_ANNOTATIONS[scene];
    const outputPath = path.join(OUTPUT_DIR, `${scene}-annotated.mp4`);

    if (annotation) {
      annotateScene(ffmpeg, videoPath, outputPath, annotation);
    } else {
      // No annotation — just re-encode to MP4
      const cmd = [
        ffmpeg,
        "-y",
        "-i",
        `"${videoPath}"`,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-an",
        `"${outputPath}"`,
      ].join(" ");
      console.log(`  Converting: ${path.basename(videoPath)}`);
      execSync(cmd, { stdio: "pipe" });
    }

    annotatedPaths.push(outputPath);
  }

  // 4. Concatenate all annotated scenes
  concatenateVideos(ffmpeg, annotatedPaths, OUTPUT_FILE);

  // 5. Clean up intermediate files
  console.log("\nCleaning up intermediate files...");
  for (const p of annotatedPaths) {
    fs.unlinkSync(p);
  }

  // 6. Report
  const stats = fs.statSync(OUTPUT_FILE);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
  console.log(`\nDone! Output: ${OUTPUT_FILE}`);
  console.log(`Size: ${sizeMB} MB`);

  // Get duration via ffprobe
  try {
    const ffprobe = findFfprobe(ffmpeg);
    const duration = execSync(
      `${ffprobe} -v error -show_entries format=duration -of csv=p=0 "${OUTPUT_FILE}"`,
      { encoding: "utf-8" }
    ).trim();
    const seconds = parseFloat(duration);
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    console.log(`Duration: ${mins}:${secs.toString().padStart(2, "0")}`);
  } catch {
    // ffprobe might not be available
  }
}

main().catch((err) => {
  console.error("Assembly failed:", err.message);
  process.exit(1);
});
