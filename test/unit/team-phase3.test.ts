import { describe, it, expect } from "vitest";
import { TeamDiffService } from "../../src/modules/features/TeamSync/TeamDiffService";

describe("TeamDiffService", () => {
    describe("computeDiff", () => {
        it("should detect insertions", () => {
            const result = TeamDiffService.computeDiff("hello", "hello world");
            expect(result.some(([op]) => op === 1)).toBe(true);
        });

        it("should detect deletions", () => {
            const result = TeamDiffService.computeDiff("hello world", "hello");
            expect(result.some(([op]) => op === -1)).toBe(true);
        });

        it("should return equal for identical content", () => {
            const result = TeamDiffService.computeDiff("same", "same");
            expect(result.length).toBe(1);
            expect(result[0][0]).toBe(0);
        });

        it("should handle empty strings", () => {
            const result = TeamDiffService.computeDiff("", "new content");
            expect(result.length).toBeGreaterThan(0);
            expect(result[0][0]).toBe(1);
        });
    });

    describe("computeDiffSummary", () => {
        it("should count added and removed characters", () => {
            const diff = TeamDiffService.computeDiff("hello world", "hello there");
            const summary = TeamDiffService.computeDiffSummary(diff);
            expect(summary.added).toBeGreaterThan(0);
            expect(summary.removed).toBeGreaterThan(0);
        });

        it("should return zero for identical content", () => {
            const diff = TeamDiffService.computeDiff("same", "same");
            const summary = TeamDiffService.computeDiffSummary(diff);
            expect(summary.added).toBe(0);
            expect(summary.removed).toBe(0);
        });
    });

    describe("renderDiffToHtml", () => {
        it("should render deletions with deleted class", () => {
            const diff = TeamDiffService.computeDiff("removed", "");
            const html = TeamDiffService.renderDiffToHtml(diff);
            expect(html).toContain("team-diff-deleted");
        });

        it("should render insertions with added class", () => {
            const diff = TeamDiffService.computeDiff("", "added");
            const html = TeamDiffService.renderDiffToHtml(diff);
            expect(html).toContain("team-diff-added");
        });

        it("should escape HTML in content", () => {
            const diff = TeamDiffService.computeDiff("", "<script>alert('xss')</script>");
            const html = TeamDiffService.renderDiffToHtml(diff);
            expect(html).not.toContain("<script>");
            expect(html).toContain("&lt;script&gt;");
        });
    });
});
