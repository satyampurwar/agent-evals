import os
from pathlib import Path

import pytest

from agent_evals_python_worker.sandbox import SandboxPathError, resolve_in_sandbox


def test_allows_nested_paths_that_do_not_exist_yet(sandbox: Path):
    target = resolve_in_sandbox(str(sandbox), "a/b/c.txt")
    assert target.startswith(os.path.realpath(sandbox))
    assert target.endswith(os.path.join("a", "b", "c.txt"))


@pytest.mark.parametrize(
    "bad", ["/etc/passwd", "../x", "a/../../x", "", "   ", None, 3]
)
def test_rejects_absolute_escaping_empty_and_non_string_paths(sandbox: Path, bad):
    with pytest.raises(SandboxPathError):
        resolve_in_sandbox(str(sandbox), bad)


def test_allows_names_that_merely_start_with_dots(sandbox: Path):
    assert resolve_in_sandbox(str(sandbox), "..notes.txt").endswith("..notes.txt")


def test_rejects_symlinks_on_the_path(sandbox: Path, tmp_path: Path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (sandbox / "link").symlink_to(outside, target_is_directory=True)
    with pytest.raises(SandboxPathError, match="symlinks are not allowed"):
        resolve_in_sandbox(str(sandbox), "link/secret.txt")
