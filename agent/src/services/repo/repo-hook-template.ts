export function buildPostReceiveHook(repoName: string): string {
  return `#!/bin/bash
DEPLOYMENTS_DIR="/app/deployments/${repoName}"
while read oldrev newrev refname; do
    branch=\$(echo "\$refname" | sed 's|refs/heads/||')
    worktree_path="\$DEPLOYMENTS_DIR/\$branch"
    if [ -d "\$worktree_path" ]; then
        cd "\$worktree_path"
        git fetch --all --prune 2>&1 || true
        git reset --hard "\$newrev" 2>&1
        git clean -fd 2>&1 || true
    fi
done
`;
}
