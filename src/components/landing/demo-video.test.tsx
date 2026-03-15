import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Set env BEFORE module import — vi.hoisted runs before static imports
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
});

import { DemoVideo } from "./demo-video";

// Mock play/pause on HTMLMediaElement prototype
let mockPaused = true;
const playMock = vi.fn(() => {
  mockPaused = false;
  return Promise.resolve();
});
const pauseMock = vi.fn(() => {
  mockPaused = true;
});

beforeEach(() => {
  mockPaused = true;
  playMock.mockClear();
  pauseMock.mockClear();

  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: playMock,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: pauseMock,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get: () => mockPaused,
  });
});

describe("DemoVideo", () => {
  it("renders the video player region", () => {
    render(<DemoVideo />);
    expect(screen.getByRole("region", { name: /demo video player/i })).toBeInTheDocument();
  });

  it("renders the video element with correct src", () => {
    render(<DemoVideo />);
    const video = screen.getByLabelText(/product demo walkthrough/i) as HTMLVideoElement;
    expect(video.tagName).toBe("VIDEO");
    expect(video.src).toContain("/storage/v1/object/public/public-assets/videos/demo.mp4");
  });

  it("shows the play overlay initially", () => {
    render(<DemoVideo />);
    const region = screen.getByRole("region", { name: /demo video player/i });
    // The overlay div has aria-hidden="false" when visible
    const overlay = region.querySelector('[aria-hidden="false"]');
    expect(overlay).not.toBeNull();
  });

  it("calls video.play() when clicking the video container", () => {
    render(<DemoVideo />);
    const video = screen.getByLabelText(/product demo walkthrough/i);
    fireEvent.click(video.parentElement!);
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it("calls video.pause() when clicking while playing", () => {
    mockPaused = false;
    render(<DemoVideo />);
    const video = screen.getByLabelText(/product demo walkthrough/i);
    fireEvent.click(video.parentElement!);
    expect(pauseMock).toHaveBeenCalledTimes(1);
  });

  it("handles keyboard shortcut: space to play", () => {
    render(<DemoVideo />);
    const region = screen.getByRole("region", { name: /demo video player/i });
    fireEvent.keyDown(region, { key: " " });
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it("handles keyboard shortcut: k to play", () => {
    render(<DemoVideo />);
    const region = screen.getByRole("region", { name: /demo video player/i });
    fireEvent.keyDown(region, { key: "k" });
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it("handles keyboard shortcut: m to toggle mute", () => {
    render(<DemoVideo />);
    const video = screen.getByLabelText(/product demo walkthrough/i) as HTMLVideoElement;
    const region = screen.getByRole("region", { name: /demo video player/i });

    expect(video.muted).toBe(false);
    fireEvent.keyDown(region, { key: "m" });
    expect(video.muted).toBe(true);
    fireEvent.keyDown(region, { key: "m" });
    expect(video.muted).toBe(false);
  });

  it("shows browser chrome decoration", () => {
    render(<DemoVideo />);
    expect(screen.getByText("vibecodes.co.uk")).toBeInTheDocument();
  });

  it("does not crash when play() rejects", () => {
    playMock.mockImplementationOnce(() => Promise.reject(new Error("Autoplay blocked")));
    render(<DemoVideo />);
    const video = screen.getByLabelText(/product demo walkthrough/i);
    // Should not throw
    fireEvent.click(video.parentElement!);
    expect(playMock).toHaveBeenCalledTimes(1);
  });
});
