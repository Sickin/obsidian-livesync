# Team Collaboration — Testing Guide

This guide covers how to test the team collaboration feature across all 6 phases. You'll need **two Obsidian vaults** syncing through the same CouchDB instance, each logged in as a different user.

---

## Prerequisites

### Environment Setup

1. **CouchDB instance** running and accessible (local or remote)
2. **Two Obsidian vaults** (Vault A = admin, Vault B = member) both configured to sync to the same CouchDB database
3. The plugin built and loaded in both vaults
4. Both vaults pointing at the same CouchDB database name

### Initial Team Setup (Vault A — Admin)

1. Open Settings > Self-hosted LiveSync > Team
2. Click **Initialize Team** and enter a team name
3. Invite a member: enter username, password, and role ("editor")
4. Confirm the team config panel shows 2 members

> After initialization, the CouchDB `_design/team_validation` document should exist. You can verify via Fauxton or `curl http://your-couch:5984/dbname/_design/team_validation`.

---

## Phase 1: Core Team Module

### What to test

| # | Test | How | Expected |
|---|------|-----|----------|
| 1 | Team initialization | Admin vault: Settings > Team > Initialize Team | Config panel shows team name and admin user |
| 2 | Invite member | Admin: enter username + password + role | New user appears in member list |
| 3 | Role change | Admin: change member from "editor" to "viewer" | Role updates in the panel |
| 4 | Password reset | Admin: reset member password | Member can log in with new password after restarting sync |
| 5 | Remove member | Admin: remove a member | User disappears from list; CouchDB user deleted |
| 6 | Validation function | Log in as viewer, try to edit a note and sync | Sync should reject the write (check CouchDB logs or sync errors) |
| 7 | `modifiedBy` attribution | Editor makes a change, admin syncs | Check document in CouchDB — should have `modifiedBy` field set to editor's username |

### Role-based access to verify

| Action | Admin | Editor | Viewer |
|--------|-------|--------|--------|
| Edit `team:config` | Yes | Rejected | Rejected |
| Edit `team:settings:*` | Yes | Rejected | Rejected |
| Create annotations | Yes | Yes | Rejected |
| Edit normal documents | Yes | Yes | Rejected |
| Write readstate documents | Yes | Yes | Yes |

---

## Phase 2: Change Indicators & Activity Feed

### What to test

| # | Test | How | Expected |
|---|------|-----|----------|
| 1 | Blue dot on unread file | Editor changes a file, admin syncs | Admin sees blue dot on that file in file explorer |
| 2 | Dot clears on open | Admin opens the file | Blue dot disappears |
| 3 | Activity feed shows changes | Admin: Cmd/Ctrl+P > "Show Team Activity" | Sidebar shows recent changes with author names |
| 4 | Activity feed limit | Generate >100 file changes | Feed caps at 100 entries (oldest are dropped) |
| 5 | Read state persists | Admin sees unread file, closes Obsidian, reopens | Blue dot still present (stored in IndexedDB) |
| 6 | Read state clears after viewing | Open file, close Obsidian, reopen | Blue dot gone for that file |

---

## Phase 3: Diff View

### What to test

| # | Test | How | Expected |
|---|------|-----|----------|
| 1 | View Team Changes (context menu) | Right-click an unread file in explorer | "View Team Changes" option appears |
| 2 | Diff view opens | Click "View Team Changes" | New tab shows old vs new content with highlighted additions/removals |
| 3 | Diff metadata | Check the diff view header | Shows file path, revision IDs, author(s), timestamps |
| 4 | Multiple authors | Two editors change the same file before admin reads it | Diff view lists both authors |
| 5 | Activity feed filtering | In activity feed sidebar, look at per-file entries | Each entry shows author and change summary |
| 6 | Compacted revision fallback | If CouchDB has compacted old revisions | Diff should gracefully show empty "old" side instead of crashing |

---

## Phase 4: Annotations (Team Notes)

### What to test

| # | Test | How | Expected |
|---|------|-----|----------|
| 1 | Create annotation | Select text in editor, right-click > "Add Team Note" | Modal appears for note input |
| 2 | @mention in annotation | Type `@username` in the note content | Mention is parsed and stored |
| 3 | Annotation highlight | After creating, the selected text is highlighted | Yellow/purple highlight decoration visible in editor |
| 4 | Annotation syncs | Create annotation in Vault A, sync to Vault B | Vault B sees the annotation when opening the same file |
| 5 | Team Notes sidebar | Cmd/Ctrl+P > "Show Team Notes" | Sidebar shows annotations mentioning current user |
| 6 | Navigate to annotation | Click an annotation in the Team Notes sidebar | Editor opens file and scrolls to the annotated range |
| 7 | Resolve annotation | Mark annotation as resolved (via sidebar) | Annotation marked resolved; styling changes |
| 8 | Text anchor drift | After annotation is created, add lines above the annotated text | Annotation should still find the text using context matching |
| 9 | Reply to annotation | Reply to an existing annotation | Reply stored with `parentId` pointing to original |

### Text Anchor Robustness

The text anchor system uses 4 strategies (in order):
1. Full context match (before + text + after)
2. Before context + selected text
3. Selected text + after context
4. Selected text only

Test by editing content around an annotation — add/remove lines before and after. The highlight should follow the text.

---

## Phase 5: Settings Governance

### What to test

| # | Test | How | Expected |
|---|------|-----|----------|
| 1 | Admin settings panel | Admin: Settings > Team (scroll down) | "Team Settings Manager" section visible with setting list |
| 2 | Set enforced setting | Admin: set a setting to "Enforced" mode, save | Setting saved to `team:settings:self-hosted-livesync` |
| 3 | Enforced applies to member | Member syncs and reopens settings | Enforced setting value applied; cannot change it |
| 4 | Set default setting | Admin: set a setting to "Default" mode | Member gets the value but can override |
| 5 | Member overrides default | Member changes a "default" setting to a different value | Override tracked in IndexedDB; next sync won't revert it |
| 6 | Member resets to team default | Member changes the setting back to match the team value | Override cleared; future pushes will apply again |
| 7 | Enforced notice (non-admin) | Non-admin opens settings | Banner: "N setting(s) are managed by your team admin" |
| 8 | Sensitive settings excluded | Admin panel setting list | `configPassphrase` and `couchDB_PASSWORD` should NOT appear |
| 9 | Settings sync on doc arrival | Admin pushes new enforced setting, member syncs | Setting applied automatically without member action |

### Important edge cases

- **Admin is exempt**: Enforced/default settings never apply to admin users
- **Settings push disabled**: If `features.settingsPush` is false in team config, governance is inactive
- **Concurrent edits**: If member changes a setting while a team settings doc is arriving, the enforced value wins

---

## Phase 6: Notifications

### Webhook Testing

| # | Test | How | Expected |
|---|------|-----|----------|
| 1 | Add webhook endpoint | Admin: Settings > Team > Notification Config > Add Webhook | Webhook entry appears with URL, platform, label fields |
| 2 | Test webhook | Click "Test" button next to a configured webhook | Webhook endpoint receives a test payload |
| 3 | Slack format | Set platform to "Slack", trigger a notification | Payload is `{text: "*Title*\nBody", username: "LiveSync Team"}` |
| 4 | Discord format | Set platform to "Discord", trigger notification | Payload has `embeds` array with title, description, color |
| 5 | Teams format | Set platform to "Teams", trigger notification | Payload is a `MessageCard` with sections |
| 6 | Disable webhook | Uncheck "enabled" on a webhook | No requests sent to that endpoint |

**Quick webhook testing:** Use [webhook.site](https://webhook.site) or `npx http-echo-server` to inspect incoming payloads.

### SMTP Email Testing

| # | Test | How | Expected |
|---|------|-----|----------|
| 1 | Configure SMTP | Admin: fill in host, port, TLS, credentials, from address | Config saved |
| 2 | Test email | Click "Test Email" with your email as a member pref | You receive a test email |
| 3 | Disabled SMTP | Uncheck "enabled" on SMTP | No emails sent |
| 4 | Invalid SMTP host | Enter a bogus host, test | Fails gracefully (15s timeout), no crash |

**Quick SMTP testing:** Use [Ethereal](https://ethereal.email/) for a free disposable SMTP inbox, or run `mailhog` locally.

### Notification Preferences (Per-User)

| # | Test | How | Expected |
|---|------|-----|----------|
| 1 | Set preferences | Member: Settings > Team > Notification Preferences | Can toggle event types and channels |
| 2 | Enable "mention" only | Enable only "mention" event type | Only @mention notifications are delivered |
| 3 | Disable all events | Disable all event types | No notifications delivered for any event |
| 4 | Email channel only | Enable email, disable webhook | Notifications sent via email only |
| 5 | Channel visibility | Admin has no webhooks configured | Member's "webhook" toggle should appear (stale until reopen — known limitation) |

### Notification Triggers

| # | Trigger | How to produce | Who gets notified |
|---|---------|---------------|-------------------|
| 1 | `mention` | Create annotation with `@bob` | bob (if mention events enabled) |
| 2 | `annotation-reply` | Reply to an annotation authored by alice | alice (if reply events enabled) |
| 3 | Self-skip | Create annotation with `@self` (your own username) | Nobody — self-notifications are suppressed |

> **Note:** `file-change` and `settings-push` notification types are defined but not yet wired to triggers. They are reserved for future use.

---

## Automated Tests

### Running Tests

```bash
# All team tests
npx vitest run test/unit/team-phase2.test.ts test/unit/team-phase3.test.ts test/unit/team-phase4.test.ts test/unit/team-phase5.test.ts test/unit/team-phase6.test.ts

# Single phase
npx vitest run test/unit/team-phase6.test.ts

# Watch mode (re-runs on file change)
npx vitest test/unit/team-phase6.test.ts
```

### Test Coverage Summary

| Phase | File | Tests | Covers |
|-------|------|-------|--------|
| 2 | `team-phase2.test.ts` | ReadStateManager, ChangeTracker | Read state persistence, unread tracking, activity feed cap |
| 3 | `team-phase3.test.ts` | TeamDiffService, ChangeTracker | Diff computation, HTML rendering, filtering |
| 4 | `team-phase4.test.ts` | AnnotationStore | Create, getById, getByFile, resolve, mock PouchDB |
| 5 | `team-phase5.test.ts` | TeamSettingsStore, TeamOverrideTracker, TeamSettingsApplier | Store CRUD, override tracking, enforced/default apply, deep equality |
| 6 | `team-phase6.test.ts` | WebhookChannel, SmtpChannel, NotificationStore, NotificationService | All 4 platforms, email building, config/prefs store, dispatch routing, self-skip |

### What's NOT covered by automated tests

These require manual testing or integration testing with a real CouchDB:

- CouchDB validation function (`validate_doc_update`) — role-based rejects
- CouchDBUserManager — actual HTTP calls to CouchDB `_users` database
- Svelte UI components — require Obsidian runtime
- SMTP socket-level sending — requires a real SMTP server
- CodeMirror annotation decorations — requires editor runtime
- File explorer blue dot decorations — requires Obsidian DOM
- Cross-vault sync of team documents

---

## End-to-End Smoke Test

Run through this checklist with two vaults to verify the full feature works:

- [ ] **Admin vault:** Initialize team, invite member as "editor"
- [ ] **Member vault:** Configure sync with member credentials, sync succeeds
- [ ] **Member vault:** Edit a file, sync
- [ ] **Admin vault:** Sync — see blue dot on changed file
- [ ] **Admin vault:** Open file — blue dot clears
- [ ] **Admin vault:** Right-click file > "View Team Changes" — diff view shows changes
- [ ] **Admin vault:** Open Team Activity sidebar — see member's changes
- [ ] **Admin vault:** Select text, right-click > "Add Team Note" with `@member`
- [ ] **Member vault:** Sync — open Team Notes sidebar — see the mention
- [ ] **Member vault:** Open file — see annotation highlight on the text
- [ ] **Admin vault:** Set an enforced setting in Team Settings Manager
- [ ] **Member vault:** Sync — setting value applied, banner shown
- [ ] **Admin vault:** Configure a webhook (use webhook.site)
- [ ] **Member vault:** Set notification preferences (enable mention + webhook)
- [ ] **Admin vault:** Create annotation mentioning member
- [ ] **Webhook endpoint:** Verify notification payload received
- [ ] **Admin vault:** Change member role to "viewer"
- [ ] **Member vault:** Try to edit a file and sync — expect sync rejection

---

## Known Limitations

1. **Stale notification channel visibility**: The `hasSmtp`/`hasWebhooks` props in the user preferences pane are computed once at mount time. If an admin enables SMTP after a member has already opened settings, the member needs to close and reopen settings to see the toggle.

2. **SMTP credentials in synced DB**: The `team:notifications:config` document (containing SMTP password) syncs to all members. Any member with PouchDB access can read it.

3. **No STARTTLS**: Non-TLS SMTP connections send AUTH LOGIN credentials in plaintext.

4. **Unimplemented notification triggers**: The `file-change` and `settings-push` event types are defined in types but have no dispatch wiring yet.

5. **Revision compaction**: If CouchDB compacts old revisions, the diff view falls back to showing empty content for the "old" side rather than the actual previous version.
