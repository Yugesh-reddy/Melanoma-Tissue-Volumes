#!/usr/bin/env python
"""
Utility for inspecting OME-Zarr metadata in the dataset.

Usage:
    python read_ome_zarr_metadata.py [optional_custom_path]
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Iterable

import zarr
from zarr.core import Array as ZarrArray
from zarr.hierarchy import Group as ZarrGroup


DEFAULT_STORE = Path(__file__).resolve().parents[1] / "Data" / "biomedvis-high-res"


def format_attrs(attrs: Iterable[tuple[str, Any]]) -> str:
    items = [f"{key}={repr(value)}" for key, value in attrs]
    return ", ".join(items) if items else "(none)"


def summarize_group(group: ZarrGroup, path: str) -> None:
    print(f"[Group] /{path or ''}")
    print(f"  keys: {sorted(group.group_keys()) or '(no child groups)'}")
    print(f"  arrays: {sorted(group.array_keys()) or '(no arrays)'}")
    if group.attrs:
        print(f"  attrs: {format_attrs(group.attrs.items())}")
    else:
        print("  attrs: (none)")


def summarize_array(array: ZarrArray, path: str) -> None:
    print(f"[Array] /{path}")
    print(f"  shape: {array.shape}")
    print(f"  dtype: {array.dtype}")
    print(f"  chunks: {array.chunks}")
    if array.attrs:
        print(f"  attrs: {format_attrs(array.attrs.items())}")
    else:
        print("  attrs: (none)")


def walk(node: ZarrGroup | ZarrArray, prefix: str = "") -> None:
    if isinstance(node, ZarrArray):
        summarize_array(node, prefix or "<root>")
        return

    summarize_group(node, prefix)
    for name in sorted(getattr(node, "group_keys", lambda: [])()):
        child_path = f"{prefix}/{name}" if prefix else name
        walk(node[name], child_path)
    for name in sorted(getattr(node, "array_keys", lambda: [])()):
        child_path = f"{prefix}/{name}" if prefix else name
        summarize_array(node[name], child_path)


def main() -> int:
    target = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_STORE
    if not target.exists():
        print(f"Target store not found: {target}")
        return 1

    try:
        store = zarr.open(target, mode="r")
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to open store: {exc}")
        return 1

    print(f"Inspecting OME-Zarr store: {target}")
    walk(store)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

