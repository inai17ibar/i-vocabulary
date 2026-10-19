import { describe, expect, it } from "vitest";
import { displayBase, normalizeApiBase, parsePresets } from "./server.ts";

describe("normalizeApiBase", () => {
  it("fills in scheme and API path for host:port input", () => {
    expect(normalizeApiBase("192.168.0.10:8787")).toBe("http://192.168.0.10:8787/api/v1");
    expect(normalizeApiBase(" localhost:8787/ ")).toBe("http://localhost:8787/api/v1");
    expect(normalizeApiBase("https://ivocab.example.com")).toBe("https://ivocab.example.com/api/v1");
  });
  it("keeps an explicit path and relative bases", () => {
    expect(normalizeApiBase("https://example.com/ivocab/api/v1/")).toBe("https://example.com/ivocab/api/v1");
    expect(normalizeApiBase("/api/v1")).toBe("/api/v1");
  });
  it("rejects empty and non-http input", () => {
    expect(normalizeApiBase("")).toBeNull();
    expect(normalizeApiBase("ftp://example.com")).toBeNull();
    expect(normalizeApiBase("http://")).toBeNull();
  });
});

describe("parsePresets", () => {
  it("parses name=url pairs and skips broken entries", () => {
    expect(parsePresets("本番=https://a.example.com;自宅=192.168.0.10:8787;壊れた;=x")).toEqual([
      { label: "本番", base: "https://a.example.com/api/v1" },
      { label: "自宅", base: "http://192.168.0.10:8787/api/v1" },
    ]);
    expect(parsePresets(undefined)).toEqual([]);
  });
});

describe("displayBase", () => {
  it("shows host for the standard path", () => {
    expect(displayBase("http://192.168.0.10:8787/api/v1")).toBe("192.168.0.10:8787");
    expect(displayBase("https://example.com/x/api/v1")).toBe("example.com/x/api/v1");
    expect(displayBase("/api/v1")).toBe("このサイトのサーバー");
  });
});
