#!/usr/bin/env python
"""
Extract one or more channels from an OME-Zarr store and emit Three.js-friendly assets.

Outputs match the existing `visualization_data/channel_{idx}_data.raw` and metadata JSON
so that the React viewer can consume them without code changes.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

import numpy as np
import zarr


def normalize_to_uint8(data: np.ndarray) -> tuple[np.ndarray, int, int]:
    data_min = int(np.min(data))
    data_max = int(np.max(data))
    if data_max == data_min:
        raise ValueError("Channel has constant value; cannot normalize")
    scaled = ((data - data_min) / (data_max - data_min) * 255).astype(np.uint8)
    return scaled, data_min, data_max


def extract_channels(
    store_path: Path,
    dataset_path: str,
    channels: Iterable[int],
    output_dir: Path,
    downsample: int,
) -> None:
    arr = zarr.open(store_path / dataset_path, mode="r")
    output_dir.mkdir(parents=True, exist_ok=True)

    for channel_idx in channels:
        print(f"\nProcessing channel {channel_idx} at {dataset_path} ...")
        try:
            data = arr[0, channel_idx, ::downsample, ::downsample, ::downsample]
        except Exception as exc:  # noqa: BLE001
            print(f"  ❌ Failed to load channel {channel_idx}: {exc}")
            continue

        shape = data.shape
        print(f"  Raw shape: {shape}")

        try:
            data_uint8, data_min, data_max = normalize_to_uint8(data)
        except ValueError as exc:
            print(f"  ⚠️ Skipping channel {channel_idx}: {exc}")
            continue

        metadata = {
            "shape": list(shape),
            "dataRange": [data_min, data_max],
            "downsampleFactor": downsample,
            "channel": channel_idx,
            "source": {
                "store": str(store_path.resolve()),
                "dataset": dataset_path,
            },
        }

        metadata_path = output_dir / f"channel_{channel_idx}_metadata.json"
        data_path = output_dir / f"channel_{channel_idx}_data.raw"
        data_uint8.tofile(data_path)
        with metadata_path.open("w", encoding="utf-8") as fh:
            json.dump(metadata, fh, indent=2)

        print("  ✅ Wrote:")
        print(f"     - {metadata_path.name}")
        print(f"     - {data_path.name} ({data_uint8.nbytes / 1024 ** 2:.2f} MB)")
        print(f"     - Data range: [{data_min}, {data_max}]")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export channels from an OME-Zarr store.")
    parser.add_argument(
        "--store",
        default=str(Path("BioProject") / "Data" / "biomedvis-6gb" / "0"),
        help="Path to the OME-Zarr group containing resolution levels.",
    )
    parser.add_argument(
        "--dataset",
        default="3",
        help="Dataset path inside the store (e.g. '0', '3' for a lower resolution).",
    )
    parser.add_argument(
        "--channels",
        nargs="+",
        type=int,
        required=True,
        help="Channel indices to export (space separated).",
    )
    parser.add_argument(
        "--output",
        default=str(Path("BioProject") / "visualization_data"),
        help="Directory for output raw + metadata files.",
    )
    parser.add_argument(
        "--downsample",
        type=int,
        default=1,
        help="Additional integer downsample factor applied uniformly in z,y,x.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    store_path = Path(args.store).resolve()
    if not store_path.exists():
        print(f"Store path not found: {store_path}")
        return 1

    output_dir = Path(args.output).resolve()
    extract_channels(store_path, args.dataset, args.channels, output_dir, args.downsample)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

