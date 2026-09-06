import { describe, expect, test } from "bun:test";
import { slugify } from "./slugify";

describe("slugify", () => {
  test("matches the migration 0023 seed for the five areas", () => {
    expect(slugify("Work & Growth")).toBe("work-growth");
    expect(slugify("Personal Life")).toBe("personal-life");
    expect(slugify("Listify")).toBe("listify");
  });

  test("strips what the SQL let through and collapses the doubles that leaves", () => {
    expect(slugify("Side / Projects")).toBe("side-projects");
    expect(slugify("  Ünïcode -- Name!  ")).toBe("ncode-name");
    expect(slugify("R&D")).toBe("rd");
  });
});
