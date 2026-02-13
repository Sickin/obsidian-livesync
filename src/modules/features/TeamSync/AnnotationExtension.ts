import { StateField, StateEffect } from "@codemirror/state";
import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import type { Extension, Text, Range } from "@codemirror/state";
import type { AnchorRange } from "./TextAnchor.ts";

export interface EditorAnnotation {
    id: string;
    range: AnchorRange;
    content: string;
    author: string;
    resolved: boolean;
    replyCount: number;
}

/** Effect to replace all annotations for the current file. */
export const setAnnotationsEffect = StateEffect.define<EditorAnnotation[]>();

/** Effect to clear all annotations. */
export const clearAnnotationsEffect = StateEffect.define();

/**
 * StateField holding annotation decorations for the current editor.
 */
const annotationField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },
    update(decorations, tr) {
        for (const e of tr.effects) {
            if (e.is(clearAnnotationsEffect)) {
                return Decoration.none;
            }
            if (e.is(setAnnotationsEffect)) {
                return buildDecorations(tr.state.doc, e.value);
            }
        }
        return decorations.map(tr.changes);
    },
    provide(field) {
        return EditorView.decorations.from(field);
    },
});

function buildDecorations(doc: Text, annotations: EditorAnnotation[]): DecorationSet {
    const decorations: Range<Decoration>[] = [];

    for (const ann of annotations) {
        try {
            const from = lineCharToOffset(doc, ann.range.startLine, ann.range.startChar);
            const to = lineCharToOffset(doc, ann.range.endLine, ann.range.endChar);
            if (from >= 0 && to > from && to <= doc.length) {
                const cls = ann.resolved
                    ? "team-annotation-highlight is-resolved"
                    : "team-annotation-highlight";
                decorations.push(
                    Decoration.mark({
                        class: cls,
                        attributes: {
                            "data-annotation-id": ann.id,
                            title: `${ann.author}: ${ann.content.slice(0, 60)}`,
                        },
                    }).range(from, to)
                );
            }
        } catch {
            // Skip annotations with invalid positions
        }
    }

    decorations.sort((a, b) => a.from - b.from || a.to - b.to);
    return Decoration.set(decorations);
}

function lineCharToOffset(doc: Text, line: number, char: number): number {
    // CM6 doc.line() is 1-based; AnchorRange lines are 0-based
    const lineObj = doc.line(line + 1);
    return lineObj.from + char;
}

/**
 * Create the CM6 extension array for annotation highlights.
 */
export function createAnnotationExtension(): Extension[] {
    return [annotationField];
}
