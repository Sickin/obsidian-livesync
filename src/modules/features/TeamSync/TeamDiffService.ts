import { diff_match_patch, DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT } from "../../../deps.ts";
import { escapeStringToHTML } from "../../../lib/src/string_and_binary/convert.ts";

export type DiffOperation = [number, string];

export interface DiffSummary {
    added: number;
    removed: number;
}

/**
 * Utility for computing and rendering diffs between document revisions.
 * Wraps diff_match_patch with team-specific rendering.
 * All static methods — no instance state needed.
 */
export class TeamDiffService {
    static computeDiff(oldText: string, newText: string): DiffOperation[] {
        const dmp = new diff_match_patch();
        const diff = dmp.diff_main(oldText, newText);
        dmp.diff_cleanupSemantic(diff);
        return diff;
    }

    static computeDiffSummary(diff: DiffOperation[]): DiffSummary {
        let added = 0;
        let removed = 0;
        for (const [op, text] of diff) {
            if (op === DIFF_INSERT) added += text.length;
            else if (op === DIFF_DELETE) removed += text.length;
        }
        return { added, removed };
    }

    static renderDiffToHtml(diff: DiffOperation[]): string {
        let html = "";
        for (const [op, text] of diff) {
            const escaped = escapeStringToHTML(text);
            if (op === DIFF_DELETE) {
                html += `<span class="team-diff-deleted">${escaped}</span>`;
            } else if (op === DIFF_INSERT) {
                html += `<span class="team-diff-added">${escaped}</span>`;
            } else {
                html += `<span class="team-diff-equal">${escaped}</span>`;
            }
        }
        return html.replace(/\n/g, "<br>");
    }
}
