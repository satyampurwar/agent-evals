"""Keep every file-tool path inside the trial's sandbox directory.

Port of `packages/sandbox/src/paths.ts`: refuse absolute paths, `..` escapes,
and symlinks — so one trial cannot read another trial's files (see scripts/demo-isolation.ts).
"""

import os
import stat


class SandboxPathError(ValueError):
    pass


def _is_inside(root: str, target: str) -> bool:
    rel = os.path.relpath(target, root)
    return rel == "." or (
        rel != ".." and not rel.startswith(".." + os.sep) and not os.path.isabs(rel)
    )


def resolve_in_sandbox(sandbox_dir: str, user_path: object) -> str:
    """Resolve a relative path inside `sandbox_dir`.

    Fails closed (SandboxPathError) for empty or non-string paths, absolute paths, `..` segments that leave
    the sandbox, and any existing symlink on the way. The target itself need not exist.
    """
    if not isinstance(user_path, str) or user_path.strip() == "":
        raise SandboxPathError("path must be a non-empty string")
    if os.path.isabs(user_path):
        raise SandboxPathError(f"absolute paths are not allowed: {user_path}")

    root = os.path.realpath(sandbox_dir)
    target = os.path.normpath(os.path.join(root, user_path))
    if not _is_inside(root, target):
        raise SandboxPathError(f"path escapes sandbox: {user_path}")

    # Walk from the target back up to the sandbox root and refuse any symlink on the way.
    cur = target
    while cur != root and _is_inside(root, cur):
        try:
            if stat.S_ISLNK(os.lstat(cur).st_mode):
                raise SandboxPathError(
                    f"symlinks are not allowed in sandbox: {user_path}"
                )
        except (FileNotFoundError, NotADirectoryError):
            pass
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent

    return target
