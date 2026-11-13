import { describe, it, expect } from "vitest";
import { homeShortPath } from "./home-short-path";

describe("homeShortPath", () => {
  it("shortens Mac and Linux home folders", () => {
    expect(homeShortPath("/Users/sam/projects/app")).toBe("~/projects/app");
    expect(homeShortPath("/home/sam")).toBe("~");
  });

  it("shortens Windows home folders, keeping backslashes", () => {
    expect(homeShortPath("C:\\Users\\Sam\\projects\\app")).toBe("~\\projects\\app");
    expect(homeShortPath("c:\\users\\Sam")).toBe("~");
  });

  it("leaves other folders alone", () => {
    expect(homeShortPath("D:\\work\\app")).toBe("D:\\work\\app");
    expect(homeShortPath("/opt/app")).toBe("/opt/app");
    expect(homeShortPath("  /opt/app ")).toBe("/opt/app");
  });
});
