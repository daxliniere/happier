# Host deployment helper

`deploy-installed-metadata.mjs` is the versioned copy of the project-root host helper. Install it at the HAPPIER project root, beside `deploy-linux.sh`. Its canonical UI identity import intentionally resolves through the existing host `worktrees/rc2` runtime package there.

This helper updates host installation bookkeeping only; it is not included in application binaries. The beta version validation repair does not change the already built release source or artifacts.

From a task worktree under the project `worktrees/` directory, run `node --test fork/host/deploy-installed-metadata.test.mjs`. Fixtures exercise real installation/restore bookkeeping with temporary state, UI and unit files, and the host's existing canonical UI identity module.
