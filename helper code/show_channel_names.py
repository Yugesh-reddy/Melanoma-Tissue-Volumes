#!/usr/bin/env python
"""
Display channel names and numbers from OME-Zarr metadata in the console.

Usage:
    python show_channel_names.py [optional_custom_path]
"""
from __future__ import annotations

import sys
from pathlib import Path

import zarr


DEFAULT_STORE = Path(__file__).resolve().parents[1] / "Data" / "biomedvis-6gb" / "0" / "3"


def extract_channel_names_from_zarr(zarr_path: Path) -> list[tuple[int, str]] | None:
    """Extract channel names and numbers from zarr metadata."""
    try:
        if not zarr_path.exists():
            print(f"Zarr path not found: {zarr_path}")
            return None

        zarr_array = zarr.open(str(zarr_path), mode='r')
        attrs = zarr_array.attrs

        # Try omero metadata first
        if 'omero' in attrs:
            channels = attrs['omero'].get('channels', [])
            if channels:
                channel_list = []
                for i, channel in enumerate(channels):
                    channel_name = channel.get('label', f'Channel {i}')
                    channel_list.append((i, channel_name))
                return channel_list

        # Try direct 'multiscales' or 'omero' at root level
        if 'multiscales' in attrs:
            # Check if there's metadata with channel info
            for ms in attrs.get('multiscales', []):
                if 'metadata' in ms:
                    metadata = ms['metadata']
                    if 'channels' in metadata:
                        channel_list = []
                        for i, ch in enumerate(metadata['channels']):
                            name = ch.get('label', ch.get('name', f'Channel {i}'))
                            channel_list.append((i, name))
                        return channel_list

        # Try OME metadata structure
        if 'omero' in attrs:
            if isinstance(attrs['omero'], dict):
                channels = attrs['omero'].get('channels', [])
                if channels:
                    channel_list = []
                    for i, ch in enumerate(channels):
                        name = ch.get('label', ch.get('name', f'Channel {i}'))
                        channel_list.append((i, name))
                    return channel_list

        # If we have shape information, at least show channel count
        if hasattr(zarr_array, 'shape') and len(zarr_array.shape) >= 2:
            num_channels = zarr_array.shape[1]  # Assuming format is [T, C, Z, Y, X]
            print(f"Found {num_channels} channels but no name metadata available")
            return [(i, f'Channel {i}') for i in range(num_channels)]

        return None

    except ImportError:
        print("zarr not installed. Install with: pip install zarr")
        return None
    except Exception as exc:
        print(f"Error reading from zarr: {exc}")
        return None


def extract_channel_names_from_xml(xml_file: Path) -> list[tuple[int, str]] | None:
    """Extract channel names from OME XML file."""
    try:
        import ome_types
    except ImportError:
        return None

    try:
        if not xml_file.exists():
            return None

        with xml_file.open('r', encoding='utf-8') as f:
            xml_content = f.read()

        # Replace problematic characters
        xml_content_clean = xml_content.replace("Â", "")

        # Parse OME XML
        ome_xml = ome_types.from_xml(xml_content_clean)

        # Extract channel names
        if ome_xml.images and len(ome_xml.images) > 0:
            channels = ome_xml.images[0].pixels.channels
            channel_list = []
            for i, channel in enumerate(channels):
                channel_name = channel.name if channel.name else f'Channel {i}'
                channel_list.append((i, channel_name))
            return channel_list

        return None

    except Exception as exc:
        print(f"Error parsing OME XML: {exc}")
        return None


def display_channels(channel_list: list[tuple[int, str]]) -> None:
    """Display channel numbers and names in a formatted table."""
    if not channel_list:
        print("No channels found to display.")
        return

    print("\n" + "=" * 60)
    print("CHANNEL INFORMATION")
    print("=" * 60)
    print(f"{'Channel #':<12} {'Channel Name':<40}")
    print("-" * 60)

    for channel_num, channel_name in channel_list:
        print(f"{channel_num:<12} {channel_name:<40}")

    print("-" * 60)
    print(f"Total channels: {len(channel_list)}")
    print("=" * 60 + "\n")


def main() -> int:
    """Main function to extract and display channel names."""
    # Determine target path
    if len(sys.argv) > 1:
        target = Path(sys.argv[1]).resolve()
    else:
        target = DEFAULT_STORE

    print(f"Reading channel information from: {target}")

    channel_list = None

    # Method 1: Try to extract from zarr metadata
    print("\n[Method 1] Attempting to read from zarr metadata...")
    if target.is_dir() or target.suffix == '':
        # It's a zarr store path
        channel_list = extract_channel_names_from_zarr(target)
    else:
        # Try to open as zarr array
        channel_list = extract_channel_names_from_zarr(target)

    # Method 2: Try OME XML file
    if not channel_list:
        print("[Method 2] Attempting to read from OME XML...")
        # Check for ome.xml in parent directories
        xml_candidates = [
            target.parent / "ome.xml",
            target.parent.parent / "ome.xml",
            Path(__file__).resolve().parents[1] / "Data" / "biomedvis-6gb" / "ome.xml",
        ]

        for xml_file in xml_candidates:
            if xml_file.exists():
                channel_list = extract_channel_names_from_xml(xml_file)
                if channel_list:
                    break

    # Display results
    if channel_list:
        display_channels(channel_list)
        return 0
    else:
        print("\n❌ Could not extract channel information.")
        print("\nPlease ensure:")
        print("  1. zarr is installed: pip install zarr")
        print("  2. Data path exists and contains OME-Zarr data")
        print("  3. Or provide OME XML file in the data directory")
        print("\nYou can also try:")
        print("  python show_channel_names.py <path_to_zarr_store>")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

