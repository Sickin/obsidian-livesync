# Team Collaboration Design

**Date:** 2026-02-12
**Status:** Draft
**Scope:** Add team-based collaboration features to Self-hosted LiveSync

## Overview

Transform Self-hosted LiveSync from a personal sync tool into a team collaboration platform supporting 5-20 person teams. All team features are built on CouchDB as the single backend, leveraging its native user authentication, `_changes` feed, and per-document revision history.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Target team size | 5-20 people | Needs real user management, doesn't need massive scale |
| Backend | CouchDB only | Native user auth, `_changes` feed, revision history. Other backends can be added later |
| Role model | Admin / Editor / Viewer | Maps cleanly to CouchDB security model |
| Change indicators | Unread changes from others, clears on open | Inbox-style UX, low noise |
| Notifications | In-Obsidian first, extensible to email + webhooks later | No external dependencies to start |
| Diff view | Both sidebar and per-file on-demand | Overview + detail when needed |
| Settings push | Per-plugin granular with Default and Enforced modes | Flexible without over-engineering |

## Architecture

### Module Structure

All team features live in a new `TeamSync` module under `src/modules/features/` following the existing module pattern (extending `AbstractObsidianModule`). Sub-components are organized as:

```
src/modules/features/TeamSync/
  TeamSyncModule.ts          # Main module, registers all team features
  UserManagement.ts          # CouchDB user CRUD + role management
  ChangeTracker.ts           # Change attribution + unread state
  TeamActivityView.ts        # Sidebar activity feed
  DiffView.ts                # Per-file and inline diff rendering
  AnnotationManager.ts       # Annotation CRUD + text anchoring
  AnnotationView.ts          # Annotation sidebar + notification panel
  SettingsPush.ts            # Team settings management + enforcement
  NotificationService.ts     # Extensible notification interface
```

### New CouchDB Documents

**`team:config`** — Single document holding team metadata and role assignments.

```json
{
  "_id": "team:config",
  "teamName": "My Research Team",
  "members": {
    "alice": { "role": "admin", "lastSync": "2026-02-12T10:00:00Z" },
    "bob": { "role": "editor", "lastSync": "2026-02-12T09:30:00Z" },
    "carol": { "role": "viewer", "lastSync": "2026-02-12T08:00:00Z" }
  },
  "features": {
    "annotations": true,
    "settingsPush": true,
    "changeIndicators": true
  }
}
```

**`team:settings:<pluginId>`** — One per managed plugin. Stores setting keys with pushed values and mode.

```json
{
  "_id": "team:settings:obsidian-git",
  "managedBy": "alice",
  "updatedAt": "2026-02-12T10:00:00Z",
  "settings": {
    "autoCommitInterval": { "value": 10, "mode": "enforced" },
    "autoPull": { "value": true, "mode": "default" }
  }
}
```

**`team:annotation:<id>`** — One per annotation.

```json
{
  "_id": "team:annotation:abc123",
  "filePath": "research/paper-draft.md",
  "range": {
    "startLine": 42,
    "startChar": 0,
    "endLine": 42,
    "endChar": 87
  },
  "contextBefore": "...surrounding text for re-anchoring...",
  "contextAfter": "...surrounding text for re-anchoring...",
  "content": "Can we add a citation here?",
  "author": "bob",
  "mentions": ["alice"],
  "timestamp": "2026-02-12T09:00:00Z",
  "resolved": false,
  "parentId": null
}
```

**Change attribution** — Extend existing document metadata to include a `modifiedBy` field:

```json
{
  "_id": "doc:research/paper-draft.md",
  "modifiedBy": "bob",
  "mtime": 1707732000000,
  ...existing fields
}
```

### Local-Only Storage (Not Synced)

**Read state** — A local PouchDB record per file tracking the last revision the current user has seen.

```json
{
  "_id": "readstate:research/paper-draft.md",
  "lastSeenRev": "3-a1b2c3d4",
  "lastSeenAt": "2026-02-12T09:00:00Z"
}
```

**Team overrides** — Tracks which team-default settings a member has intentionally customized.

```json
{
  "_id": "teamoverrides:obsidian-git",
  "overridden": ["autoPull"]
}
```

### CouchDB Security

| Role | CouchDB mapping | Permissions |
|---|---|---|
| Admin | CouchDB admin | Full CRUD, user management, settings push |
| Editor | CouchDB member | Read/write documents, no user management |
| Viewer | CouchDB member | Read only, enforced by validation function |

A `validate_doc_update` design document enforces write restrictions:

- Viewers can only update their own read-state documents
- Editors can write normal documents and annotations but not `team:config` or `team:settings:*`
- Admins have no restrictions

## Feature Details

### 1. User Management

**Admin UI** — A new "Team Management" tab inside the existing LiveSync settings panel. Only visible to users with the `admin` role.

Three sections:

1. **Team Overview** — Team name, number of active members, sync status.
2. **Member List** — Table showing username, role, and last sync timestamp (from CouchDB `_changes` feed). Actions per row: change role, reset password, remove from team.
3. **Invite Member** — Form to create a new CouchDB user with username, temporary password, and role. Admin shares credentials out-of-band.

**Under the hood:**

- Creating a user writes to CouchDB's `_users` database and updates `team:config` with their role.
- Role changes update both `team:config` and the CouchDB database security object.
- The validation function checks the user's role before allowing writes.

**First-time team setup:**

When an admin enables team mode, the plugin:
1. Creates the `team:config` document
2. Installs the validation function as a CouchDB design document
3. Registers the current user as the first admin

Existing solo users connecting to the same DB are prompted to "join the team" and receive a role from the admin.

### 2. Change Indicators

**Blue dot indicator** on files in Obsidian's file explorer when someone else has modified the file since you last opened it.

**Tracking flow:**

1. On each sync cycle, check incoming revisions from CouchDB's `_changes` feed.
2. For each changed file, compare `modifiedBy` against current username. If different, mark as unread.
3. Local read-state store keeps `filePath -> lastSeenRevision`.
4. Opening a file updates read-state to current revision and removes the indicator.

**File explorer decoration:**

Uses Obsidian's `registerFileDecorator` API (available since Obsidian 1.6+). Applies a `team-file-changed` CSS class to unread files. The blue dot is rendered via CSS pseudo-element.

**Team Activity sidebar:**

A chronological feed of recent changes showing file name, author (initials badge), and timestamp. Clicking an entry opens the file and clears its unread state. Feed is capped at 100 entries, grouped by day.

### 3. Diff View

**Per-file diff (on demand):**

Right-click a file and choose "View Team Changes." Opens a side-by-side diff in a new Obsidian leaf: your last-seen revision on the left, current revision on the right. Additions in green, deletions in red. Header shows author(s) and timestamp.

Pulls revisions from CouchDB via `get(docId, {rev: revId})`. Reuses diff logic from `livesync-commonlib` (already used by the conflict resolver).

If multiple people changed the file since your last view, the diff collapses into a single comparison (last seen -> current) with all contributors listed in the header.

**Inline diff in sidebar:**

Each entry in the Team Activity sidebar is expandable. Clicking the arrow shows a compact unified diff inline. Allows quick scanning without opening each file.

**Sidebar filtering:**

- By author — dropdown of team members
- By date range — today, last 7 days, custom
- By folder — scope to a specific vault folder

### 4. Annotations & Notes

**Creating an annotation:**

Select text, right-click, choose "Add Team Note." A popover appears for typing the note and mentioning team members with `@username`. Submitting creates a `team:annotation:<id>` document in CouchDB.

**Rendering:**

Annotations appear as highlighted text spans (subtle yellow background) using CodeMirror 6 editor decorations. Hover shows a tooltip with note content, author, and timestamp. Click opens an inline thread for replies (child annotations referencing parent).

**Text re-anchoring:**

Annotations store both the text range and ~50 characters of surrounding context. When the file changes, the plugin fuzzy-matches the context snippet to re-anchor the annotation. If the anchor can't be found (section deleted), the annotation is marked "orphaned" and flagged in the notification panel.

**Notification panel:**

A "Team Notes" sidebar view shows annotations where you're mentioned or on files you've recently edited. Unread annotations show a badge count on the sidebar icon. Annotations can be resolved by the author or an admin.

**Future notification channels:**

The `NotificationService` is designed as an extensible interface:

```typescript
interface NotificationChannel {
  send(notification: TeamNotification): Promise<void>;
}
```

Phase 6 adds `EmailChannel` (SMTP) and `WebhookChannel` (Slack/Discord/Teams) implementations.

### 5. Selective Settings Push

**Admin interface:**

Inside "Team Management," a "Team Settings" section lists all installed plugins. Admin expands a plugin to see its settings as key-value pairs (from `data.json`).

Each setting has a three-state toggle:
- **Not managed** (default) — Members keep their own value
- **Default** (D badge) — Pushed to members who haven't customized it
- **Enforced** (E badge + lock icon) — Always overrides local

Setting the mode to Default or Enforced captures the current value into `team:settings:<pluginId>`.

**Member experience:**

On each sync, the client pulls `team:settings:*` documents:

1. **Enforced** — Overwrites local value. Setting appears grayed out in plugin UI with "Managed by team admin" label.
2. **Default** — Checks `team:overrides` record. If member hasn't customized, applies team value. If they have, local value wins.

When a member customizes a team-default setting, it's recorded in `team:overrides`. A "Reset to team default" option lets them revert.

**Obsidian core settings** — Same mechanism works for Obsidian's own settings (editor, appearance, hotkeys) by selecting "Obsidian Core" from the plugin list.

## Implementation Phases

### Phase 1 — Foundation
- `TeamSync` module scaffolding
- User management + roles (Admin/Editor/Viewer)
- `modifiedBy` attribution on document writes
- `team:config` document + CouchDB validation function
- **Delivers:** Team setup, user management, role-based access control

### Phase 2 — Awareness
- Change indicators (blue dots in file tree)
- Local read-state tracking
- Team Activity sidebar with change feed
- **Delivers:** Visibility into team activity, unread file tracking

### Phase 3 — Understanding
- Per-file diff view (reusing existing diff logic)
- Inline diff in the activity sidebar
- Filtering by author, date, folder
- **Delivers:** Ability to see exactly what changed and who changed it

### Phase 4 — Collaboration
- Annotations with text anchoring and fuzzy re-anchoring
- Inline threads and replies
- In-Obsidian notification panel
- **Delivers:** Contextual team communication within documents

### Phase 5 — Governance
- Selective settings push (Default + Enforced modes)
- Enforced setting lockout in plugin UIs
- Obsidian core settings support
- **Delivers:** Admin control over team configuration

### Phase 6 — Extended Notifications
- Email notifications via SMTP
- Webhook notifications for Slack/Discord/Teams
- Notification preferences per user
- **Delivers:** Notifications outside of Obsidian

Each phase is independently useful. A team gets meaningful value after Phase 1 + 2 alone.
