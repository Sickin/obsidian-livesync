const CONTEXT_CHARS = 50;

export interface AnchorRange {
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
}

export interface AnchorContext {
    selectedText: string;
    contextBefore: string;
    contextAfter: string;
    originalRange: AnchorRange;
}

export class TextAnchor {
    static captureContext(docText: string, range: AnchorRange): {
        selectedText: string;
        contextBefore: string;
        contextAfter: string;
    } {
        const lines = docText.split("\n");
        const startOffset = TextAnchor._toOffset(lines, range.startLine, range.startChar);
        const endOffset = TextAnchor._toOffset(lines, range.endLine, range.endChar);
        const selectedText = docText.slice(startOffset, endOffset);
        const beforeStart = Math.max(0, startOffset - CONTEXT_CHARS);
        const afterEnd = Math.min(docText.length, endOffset + CONTEXT_CHARS);
        return {
            selectedText,
            contextBefore: docText.slice(beforeStart, startOffset),
            contextAfter: docText.slice(endOffset, afterEnd),
        };
    }

    static findAnchor(docText: string, anchor: AnchorContext): AnchorRange | null {
        const { selectedText, contextBefore, contextAfter } = anchor;
        const lines = docText.split("\n");

        // Strategy 1: Full context match
        const fullPattern = contextBefore + selectedText + contextAfter;
        let idx = docText.indexOf(fullPattern);
        if (idx !== -1) {
            const selStart = idx + contextBefore.length;
            const selEnd = selStart + selectedText.length;
            return TextAnchor._toRange(lines, selStart, selEnd);
        }

        // Strategy 2: contextBefore + selectedText
        if (contextBefore) {
            const pattern2 = contextBefore + selectedText;
            idx = docText.indexOf(pattern2);
            if (idx !== -1) {
                const selStart = idx + contextBefore.length;
                const selEnd = selStart + selectedText.length;
                return TextAnchor._toRange(lines, selStart, selEnd);
            }
        }

        // Strategy 3: selectedText + contextAfter
        if (contextAfter) {
            const pattern3 = selectedText + contextAfter;
            idx = docText.indexOf(pattern3);
            if (idx !== -1) {
                return TextAnchor._toRange(lines, idx, idx + selectedText.length);
            }
        }

        // Strategy 4: selectedText alone
        idx = docText.indexOf(selectedText);
        if (idx !== -1) {
            return TextAnchor._toRange(lines, idx, idx + selectedText.length);
        }

        return null;
    }

    static _toOffset(lines: string[], line: number, char: number): number {
        let offset = 0;
        for (let i = 0; i < line && i < lines.length; i++) {
            offset += lines[i].length + 1;
        }
        return offset + char;
    }

    static _toRange(lines: string[], startOffset: number, endOffset: number): AnchorRange {
        let offset = 0;
        let startLine = 0, startChar = 0, endLine = 0, endChar = 0;
        let foundStart = false;

        for (let i = 0; i < lines.length; i++) {
            const lineEnd = offset + lines[i].length;
            if (!foundStart && startOffset <= lineEnd) {
                startLine = i;
                startChar = startOffset - offset;
                foundStart = true;
            }
            if (foundStart && endOffset <= lineEnd) {
                endLine = i;
                endChar = endOffset - offset;
                break;
            }
            offset = lineEnd + 1;
        }

        return { startLine, startChar, endLine, endChar };
    }
}
