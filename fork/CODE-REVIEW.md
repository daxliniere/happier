# CodeRabbit reviews for the personal fork

Use a small pull request in `daxliniere/happier` to get CodeRabbit feedback on a
completed task before release integration. Keep focused tests, typechecks and
other applicable repository checks. CodeRabbit provides another review pass;
its findings still need to be checked against the code and requirements.

## Repository setup

Install the [CodeRabbit GitHub App](https://github.com/apps/coderabbitai) for
`daxliniere/happier`, selecting only that repository if other access is unnecessary.
The root `.coderabbit.yaml` configures balanced reviews for PRs targeting any
branch, including fork release branches and review bases. Draft PRs are excluded
from automatic review.

CodeRabbit currently provides free reviews for public repositories, subject to
rate limits. Public repositories with fewer than ten stars require a manual
trigger: see the [official open source setup guidance](https://kb.coderabbit.ai/articles/8856795235-how-do-i-activate-coderabbit-pro-for-my-open-source-project).
Do not interpret the absence of an automatic review as a clean result.

## Task-session workflow

1. Start the task from the source commit in the latest completed successful build
   record, following the parent project's worktree rules. Complete the scoped
   change and applicable focused checks, then commit it in its task worktree.
2. Use `dax/review-base/<built-version>` as the review-only base branch. Create it
   at that build's exact recorded source commit if absent; if present, verify
   its commit matches. Keep the base pinned. Push it and the task branch to
   `origin` (`daxliniere/happier`) only. A new successful build gets a new base.
   These bases keep already-built fork changes out of the task's PR diff.
3. Inspect `git diff --stat <review-base>...HEAD` and the full diff. Open a
   non-draft PR in the fork targeting that review base. Include the task intent,
   focused validation and any known limitations. Fork-only tasks may include
   their own `fork/` files; upstream submissions must remain separately clean.
4. Post `@coderabbitai review` as a comment on that PR. Wait for an actual
   CodeRabbit response. Read the review, inline comments and walkthrough, including
   any skipped files, errors or rate-limit messages. A green check alone does
   not prove a review ran. Verify the reviewed commits cover the latest task head.
5. Reproduce or otherwise verify each actionable finding. Fix valid in-scope
   issues, rerun affected checks, commit and push. Explain rejected findings with
   concrete evidence. Request another `@coderabbitai review` after fixes if the
   new head has not been reviewed. Use `@coderabbitai full review` when a complete
   fresh pass is needed, rather than on every push. Respect reported rate limits.
6. Report the PR URL, reviewed commit, checks and remaining findings or review
   blockers. An unavailable review does not invalidate completed local checks,
   but must be explicit in the release handoff. The designated build session
   assembles the task branch under the existing release inventory rules.

Review PRs do not authorize merging into a review base or release branch. Keep
review bases pinned; release assembly remains the build session's responsibility.
Creating a separate upstream PR does not replace the fork review or release handoff.

## Cost and review effort

Use lower-effort models for straightforward, bounded tasks when appropriate.
CodeRabbit can replace a routine duplicate model review where repository rules
allow it. Keep stronger-model or independent review for difficult diagnosis,
architecture, security, compatibility and other required risk boundaries.
Do not lower effort automatically or skip required validation because a reviewer
may catch mistakes later.

## Missing reviews

If a manual request produces no CodeRabbit response, verify the app installation
and repository access in [GitHub installed apps](https://github.com/settings/installations)
and the [CodeRabbit dashboard](https://app.coderabbit.ai/). Check the walkthrough
for disabled reviews, skipped paths, configuration errors or rate limits. See
[review controls](https://docs.coderabbit.ai/pr-reviews/when-reviews-run).

The configuration uses CodeRabbit's V2 schema. Validate changes against the
[official schema](https://coderabbit.ai/integrations/schema.v2.json) and inspect
the configuration reported by a real PR review before claiming end-to-end setup
is verified. No local API key or CLI installation is needed for GitHub PR reviews.
