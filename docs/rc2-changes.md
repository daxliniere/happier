# Happier fork: changes from public release to rc2

| Item | Detail |
|---|---|
| Baseline | Public release `v0.2.19` (`ui-web-v0.2.19`, 23 Oct 2026) |
| Target | `dax/fork-rc2`, fork build `0.2.19-fork.23`, tip `da5e7d971e` |
| Excluded | Settings search (no trace in the tree); the separate 0.3 migration |

The rc2 range holds about 420 commits: 61 by the fork owner and about 290 from upstream contributors.

Status key:
- **Verified**: the code is present at the rc2 tip and a test or wiring check covers it.
- **Present**: the code is in the tree, but no test or wiring check was traced.
- **Not verified**: the claim could not be confirmed from the tree.
- **Not found**: nothing in the tree matches the claim.

Nothing here was run on a device or in the app. Verification covers code presence, wiring and tests only.

## Fork work

### Usage and quota

| Feature | Status | Evidence |
|---|---|---|
| Colour-coded usage rings beside the model chip and in the agent rail | Verified | `AgentInputProviderUsageBadge`, `TokenUsageRing` and `ProviderUsageRing` are used in `AgentInput.tsx`; tests `ProviderUsageRing.test.tsx`, `TokenUsageRing.test.tsx` |
| Provider usage strip in the sessions pane | Verified | `ProviderUsageStrip` rendered in `SessionsListWrapper.tsx` |
| Usage ring in the New Session composer | Present | Shared composer path in `AgentInput.tsx`; the New Session route was not traced separately |
| Usage meter rework (header strip, native-login rings) | Present | Strip and rings are in the tree; the fork.23 build was not verified here |
| Context and usage remaining indicators unified | Verified | Commit `9d7b232947` touches `AgentInputContextUsageBadge`; tests `AgentInput.contextUsageBadge.test.tsx`, `AgentInputContextUsageBadge.test.tsx` |

### Sessions and session list

| Feature | Status | Evidence |
|---|---|---|
| Unseen-update row animations (fade, glow, sweep) in light blue (#732) | Verified | `updatedSessionAnimation.ts` (commit `c6ecd31cbe`) with its test; larger dots in `685894cf2c` |
| Hide Guardian review sessions on Session History | Verified | Switch `hideGuardianReviewSessions` in `session/archived.tsx`; en.ts marks that screen as the session history screen. Upstream also hides Guardian reviews from Direct discovery (`01e39485bc`) |
| Combined Happier and Direct session list (storage tabs rework) | Verified | Storage-kind filter in `useVisibleSessionListViewData`; `SessionsListStorageChrome` has a Direct browse button and no tab markup |
| Session list header refactor | Present | `SessionListHeaderFrame` and `SessionListHeaderControls` with a test |
| Native session aliases (Claude and Codex native IDs) | Verified | `nativeSessionAliases.ts` in both backends; Claude test `nativeSessionAliases.test.ts` |
| Friendly session names as clickable links | Verified | `MessageView.tsx` navigates `/session/<id>` links; `NativeSessionReferencesProvider` resolves names |
| Jump to top button that loads the full transcript | Verified | `useTranscriptJumpHost` and `jumpToTopAffordanceState`, wired through `ChatListInternal.tsx`; tests present |
| Pinned sessions stay in their reorder group | Verified | `buildSessionListTreeRows.ts` changed in `0e1fe48f39`, with a folder-move test |
| Project headers kept for path-less groups (fork.16) | Verified | `SessionsList.tsx` and `sessionListViewData.ts` changed in `8ad4021f4d`; `sessionListViewData.test.ts` |
| Dismiss a stale background command report on this device | Present | `BackgroundTaskDetail`, `useBackgroundTaskAcknowledgements`, `fromBackgroundTasks` with tests. Upstream #774 is still open on GitHub, so this does not close it until the fix is confirmed against the issue |
| Agent chip picker popover fix (fork.8) | Not verified | `AgentInputChipPickerPopover.tsx` was reworked in `2ce685c153` (fork.4), which adds a Done row for detail panes. No fork.8 commit matches the tracker's "popover fix", so the fix itself is not identified |

### Composer and attachments

| Feature | Status | Evidence |
|---|---|---|
| Take photo in the attachments chooser (#761) | Verified | `onTakePhoto` in `createAttachmentActionChip.tsx`; test `createAttachmentActionChip.test.tsx`. Camera not tested on a device |
| Composer draft Error badge explains itself when tapped (#752) | Verified | `sessionDraftStatusPresentation.tsx` with its test; commit `f88a10ae15` |
| Composer locks once Send is accepted | Verified | `NewSessionDraftComposerActions.tsx` with its test; commit `06439e4979` |
| Share to a new session (system share sheet) | Present | `ShareIntakeRuntime` and `mapShareIntentToNewSession`; `expo-share-intent` in `apps/ui/package.json` with a dev stub. Not tested on a device |

### Claude and permissions

| Feature | Status | Evidence |
|---|---|---|
| Mid-turn permission-mode changes apply to later tool calls | Verified | `permissionHandler.ts` changed in `0f018f74f5`; `permissionHandler.metadataUpdateAutoApprove.test.ts` |
| Pending requests auto-approve when metadata flips to yolo | Verified | Same test file |

### Web UI and menus

| Feature | Status | Evidence |
|---|---|---|
| Wider web scrollbars (#751) | Verified | `theme.css` changed in `7fb0cfbfbf`: scrollbar width and height 12px to 16px. The removed resize strip in `ResizableDockedPane.tsx` was not diffed |
| Hide MCP Quick Install presets already installed (#763) | Verified | `McpServerQuickInstallTab.tsx`; `McpServersSettingsScreen.test.tsx` checks that Quick Install offers only uninstalled presets |
| Theme selector up and down arrow buttons | Present | `ThemeSelectionDropdown.tsx` has previous and next `IconAction` buttons (caret-up and caret-down) beside the dropdown, added in snapshot commit `d2f4cb8027`. No test references them. Reported working on device by the owner; not run here |
| Fork build version shown in the app | Verified | Settings reads `fork/VERSION` through `app.config.js`; machine metadata shows the fork version too |

### Build and release (fork-only)

| Feature | Status | Evidence |
|---|---|---|
| Fork version file and build/sync scripts | Verified | `fork/VERSION`, `fork/build-version.json`, and `fork/scripts/` (bump, compile, github-sync, prepare-deploy, build-windows-exe) at the tip |
| Unsigned Windows dev build workflow | Present | `.github/workflows/build-windows-dev.yml` exists; the workflow was not run |
| Desktop dev updater points at the fork's release feed | Verified | `apps/ui/src-tauri/tauri.publicdev.conf.json` now points at `daxliniere/happier` releases (commit `c4b0ccc1d3`) |

### Not done or parked

| Request | Status | Notes |
|---|---|---|
| Beta mode (#754) | Parked | From the tracker; needs a product decision on release channels |

## Upstream work merged into rc2 (selected)

These come from upstream contributors. Several are upstream fixes the fork cherry-picked for its own issues. Each commit below is an ancestor of the rc2 tip.

| Issue | Summary | Commit |
|---|---|---|
| #762 | Device-link failures explain the reason | `60f53cd165` |
| #764 | Navigation arrows track all session changes; desktop history keeps visits | `698c8f369f` |
| #765 | Optional Windows title bar with compact controls | `b85989607a` |
| #766 | Copy session IDs from session menus | `a4c8a3a174` |
| #675 | Pin and information actions in the session menu | `84f9bff28c` |
| #674 | Linux service drift repair loop fixed | `a3121ed539` |
| #688 | Deleted drafts cannot be saved back by an open composer | `318f10f514` |
| #662 | Warning when pairing while disconnected | `08a75ce858` |
| #705 | Transcript catch-up cannot hang indefinitely | `8a2d010760` |
| #731 | "Continue with {agent}" works without typing | `48d42d4204` |
| #786 | Session title preservation (applied to rc2 by the fork owner) | `e36b6dea67` |
| #759 | Configured package runners are no longer replaced by a downloaded pnpm | `a41902e604` |

Other upstream work includes:
- session colours and projects (`ae3773c7cd`);
- the Windows native service launcher (`5133d3615e`);
- iOS and Android notification actions and push answers (`d839a34667`);
- the Codex WebSocket transport (`90c5d57fd0`);
- sync recovery (`180d294480`);
- README translations (`cb6aa21ccf`).

## Net-zero changes

- The managed pnpm bootstrap resume (`3467168db8`) was reverted (`19729aa87b`). The upstream fix for #759 (`a41902e604`) is in rc2.
- A test-only revert (`3c3fe18d3b`) cancels its original commit (`a6b83527aa`). Other test reverts were not traced.

## Known gaps before release

- PowerShell scripts and live installation or UI checks are not verified.
- The app, the test suites and any device check were not run for this document.
- Not verified: the agent chip popover fix (the fork.8 change is not identified), and whether the stale-background dismiss resolves #774, which is still open upstream.
- Untested: the theme selector previous and next buttons have no test coverage.
