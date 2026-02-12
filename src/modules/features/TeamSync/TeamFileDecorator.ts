import { eventHub } from "../../../common/events.ts";
import { EVENT_TEAM_FILE_CHANGED, EVENT_TEAM_FILE_READ, EVENT_TEAM_ACTIVITY_UPDATED } from "./events.ts";
import type { ChangeTracker } from "./ChangeTracker.ts";

/**
 * Decorates the file explorer with blue dots for unread files.
 *
 * Uses CSS data attributes on file explorer items to style unread files.
 * Refreshes when team events fire.
 */
export class TeamFileDecorator {
    private _styleEl: HTMLStyleElement | undefined;
    private _disposers: (() => void)[] = [];
    private _refreshTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private _tracker: ChangeTracker,
        private _containerEl: HTMLElement
    ) {
        this._injectStyles();
        this._registerEvents();
        this._refresh();
    }

    private _injectStyles(): void {
        this._styleEl = document.createElement("style");
        this._styleEl.id = "team-file-decorator-styles";
        this._styleEl.textContent = `
            .nav-file-title[data-team-unread="true"]::after {
                content: "";
                display: inline-block;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background-color: var(--interactive-accent);
                margin-left: 4px;
                flex-shrink: 0;
            }
        `;
        document.head.appendChild(this._styleEl);
    }

    private _registerEvents(): void {
        this._disposers.push(
            eventHub.onEvent(EVENT_TEAM_FILE_CHANGED, () => this._scheduleRefresh()),
            eventHub.onEvent(EVENT_TEAM_FILE_READ, () => this._scheduleRefresh()),
            eventHub.onEvent(EVENT_TEAM_ACTIVITY_UPDATED, () => this._scheduleRefresh())
        );
    }

    private _scheduleRefresh(): void {
        if (this._refreshTimer !== undefined) return;
        this._refreshTimer = setTimeout(() => {
            this._refreshTimer = undefined;
            this._refresh();
        }, 50);
    }

    /**
     * Refresh all file explorer decorations.
     * Finds file items in the explorer and sets/removes data attributes.
     */
    private _refresh(): void {
        const unreadFiles = this._tracker.getUnreadFiles();
        const fileItems = this._containerEl.querySelectorAll(".nav-file-title");

        fileItems.forEach((item) => {
            const el = item as HTMLElement;
            const path = el.getAttribute("data-path");
            if (!path) return;

            if (unreadFiles.has(path)) {
                el.setAttribute("data-team-unread", "true");
            } else {
                el.removeAttribute("data-team-unread");
            }
        });
    }

    /**
     * Cleanup styles and event listeners.
     */
    destroy(): void {
        for (const dispose of this._disposers) {
            dispose();
        }
        this._disposers = [];
        if (this._refreshTimer !== undefined) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = undefined;
        }
        if (this._styleEl) {
            this._styleEl.remove();
            this._styleEl = undefined;
        }
    }
}
