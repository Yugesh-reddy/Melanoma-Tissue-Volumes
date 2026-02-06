#!/usr/bin/env python3
"""
Convert the BiomedVis melanoma Zarr volume into the per-channel files the web app
loads from visualization_data/. This is the offline data-preparation step.

It is self-contained: it loads the OME-Zarr volume itself (via Dask), normalizes
each 16-bit channel to 8-bit, and writes, for every channel N:

  visualization_data/channel_N_data.raw       flat uint8 Z*Y*X bytes (Z-major)
  visualization_data/channel_N_metadata.json  {shape, dataRange, downsampleFactor, channel}

Prerequisites:
  pip install dask zarr numpy        (or: pip install -r downloadData/requirements.txt)
  python downloadData/download_dataset.py    # downloads the Zarr volume first

Usage:
  python create_all_channels.py                              # all 70 channels, full res
  python create_all_channels.py --downsample 2               # half resolution per axis
  python create_all_channels.py --channels 19,27,37          # only these channels
  python create_all_channels.py --zarr-path path/to/0/3      # custom Zarr location
"""
import argparse
import json
from pathlib import Path

import numpy as np


def load_dask_array(zarr_path):
    """Load the OME-Zarr volume as a lazy Dask array of shape (t, c, z, y, x)."""
    import dask.array as da

    path = Path(zarr_path)
    if not path.exists():
        raise FileNotFoundError(
            f"Zarr path not found: {path.resolve()}\n"
            f"Download it first with: python downloadData/download_dataset.py"
        )
    return da.from_zarr(str(path))


def _convert_channel(dask_array, channel_idx, downsample_factor, output_dir):
    """Materialize, normalize, and write one channel. Returns (ok, message)."""
    channel_data = dask_array[
        0, channel_idx,
        ::downsample_factor, ::downsample_factor, ::downsample_factor
    ].compute()

    data_min, data_max = channel_data.min(), channel_data.max()
    if data_max == data_min:
        return False, f"all values identical ({data_min})"

    norm = ((channel_data - data_min) / (data_max - data_min) * 255).astype(np.uint8)

    metadata = {
        "shape": list(channel_data.shape),
        "dataRange": [int(data_min), int(data_max)],
        "downsampleFactor": downsample_factor,
        "channel": channel_idx,
    }
    (output_dir / f"channel_{channel_idx}_metadata.json").write_text(json.dumps(metadata, indent=2))
    norm.tofile(output_dir / f"channel_{channel_idx}_data.raw")

    mb = norm.nbytes / (1024 ** 2)
    return True, f"shape={list(channel_data.shape)} range=[{int(data_min)}, {int(data_max)}] {mb:.1f} MB"


def create_channels(dask_array, channels, downsample_factor=1, output_dir="visualization_data"):
    """Convert the given channel indices to .raw + .json. Returns (successful, failed)."""
    out = Path(output_dir)
    out.mkdir(exist_ok=True)

    print(f"Writing {len(channels)} channel(s) to {out}/  (downsample={downsample_factor})")
    successful, failed = [], []
    for n in channels:
        try:
            ok, msg = _convert_channel(dask_array, n, downsample_factor, out)
            if ok:
                print(f"  channel {n}: OK   {msg}")
                successful.append(n)
            else:
                print(f"  channel {n}: SKIP {msg}")
                failed.append((n, msg))
        except Exception as e:  # noqa: BLE001 - keep going on per-channel errors
            print(f"  channel {n}: FAIL {e}")
            failed.append((n, str(e)))

    print(f"\nDone. {len(successful)} written, {len(failed)} skipped/failed.")
    for n, msg in failed:
        print(f"  failed channel {n}: {msg}")
    return successful, failed


# Backwards-compatible helper for a pre-loaded Dask array (e.g. from a REPL).
def create_all_channels_data(daskArray, downsample_factor=1, start_channel=0, end_channel=69):
    return create_channels(daskArray, list(range(start_channel, end_channel + 1)), downsample_factor)


def main():
    parser = argparse.ArgumentParser(
        description="Convert the melanoma Zarr volume into per-channel .raw + .json files for the web app."
    )
    parser.add_argument("--zarr-path", default="biomedvis-6gb/0/3",
                        help="Path to the downloaded OME-Zarr array (default: biomedvis-6gb/0/3).")
    parser.add_argument("--output-dir", default="visualization_data",
                        help="Output directory (default: visualization_data).")
    parser.add_argument("--downsample", type=int, default=1,
                        help="Spatial downsample factor; 1 = full resolution (default: 1).")
    parser.add_argument("--channels", default=None,
                        help="Comma-separated channel indices (e.g. 19,27,37). Default: all in --start..--end.")
    parser.add_argument("--start", type=int, default=0,
                        help="First channel index when --channels is omitted (default: 0).")
    parser.add_argument("--end", type=int, default=69,
                        help="Last channel index when --channels is omitted (default: 69).")
    args = parser.parse_args()

    if args.channels:
        channels = [int(c) for c in args.channels.split(",") if c.strip() != ""]
    else:
        channels = list(range(args.start, args.end + 1))

    dask_array = load_dask_array(args.zarr_path)
    print(f"Loaded Zarr volume {args.zarr_path}  shape={dask_array.shape} dtype={dask_array.dtype}")
    create_channels(dask_array, channels, args.downsample, args.output_dir)


if __name__ == "__main__":
    main()
