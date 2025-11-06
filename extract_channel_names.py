"""
Script to extract channel names from zarr metadata or OME XML and update channel_names.json
Run this script to update the channel names in the React app.

Usage:
    python extract_channel_names.py
"""

import json
from pathlib import Path

def extract_channel_names_from_zarr():
    """Extract channel names from zarr metadata if available."""
    try:
        import zarr
        from pathlib import Path
        
        data_path = Path("Data/biomedvis-6gb/0/3")
        if not data_path.exists():
            print(f"Data path not found: {data_path}")
            return None
            
        zarr_array = zarr.open(str(data_path), mode='r')
        attrs = zarr_array.attrs
        
        if 'omero' in attrs:
            channels = attrs['omero'].get('channels', [])
            channel_names = [c.get('label', f'Channel {i}') for i, c in enumerate(channels)]
            print(f"Found {len(channel_names)} channels in zarr metadata")
            return channel_names
        else:
            print("No 'omero' metadata found in zarr attributes")
            return None
    except ImportError:
        print("zarr not installed. Install with: pip install zarr")
        return None
    except Exception as e:
        print(f"Error reading from zarr: {e}")
        return None

def extract_channel_names_from_xml(xml_content):
    """Extract channel names from OME XML content."""
    try:
        import ome_types
        
        # Replace problematic characters
        xml_content_clean = xml_content.replace("Â", "")
        
        # Parse OME XML
        ome_xml = ome_types.from_xml(xml_content_clean)
        
        # Extract channel names
        if ome_xml.images and len(ome_xml.images) > 0:
            channels = ome_xml.images[0].pixels.channels
            channel_names = [c.name for c in channels]
            print(f"Found {len(channel_names)} channels in OME XML")
            return channel_names
        else:
            print("No images found in OME XML")
            return None
    except ImportError:
        print("ome_types not installed. Install with: pip install ome-types")
        return None
    except Exception as e:
        print(f"Error parsing OME XML: {e}")
        return None

def update_channel_names_json(channel_names):
    """Update the channel_names.json file with extracted names."""
    if not channel_names:
        print("No channel names to update")
        return
    
    # Ensure we have at least 70 channels (pad with "Channel X" if needed)
    CHANNEL_COUNT = 70
    while len(channel_names) < CHANNEL_COUNT:
        channel_names.append(f"Channel {len(channel_names)}")
    
    # Truncate if more than needed
    channel_names = channel_names[:CHANNEL_COUNT]
    
    # Write to JSON file
    output_file = Path("src/channel_names.json")
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(channel_names, f, indent=2, ensure_ascii=False)
    
    print(f"✓ Updated {output_file} with {len(channel_names)} channel names")
    print(f"  First few names: {channel_names[:5]}")
    print(f"  Last few names: {channel_names[-5:]}")

def main():
    """Main function to extract and update channel names."""
    print("Extracting channel names...")
    
    # Try method 1: Extract from zarr metadata (if available)
    print("\nMethod 1: Trying to extract from zarr metadata...")
    channel_names = extract_channel_names_from_zarr()
    
    # Try method 2: Extract from local OME XML file (if exists)
    if not channel_names:
        print("\nMethod 2: Trying to extract from local OME XML file...")
        ome_xml_file = Path("Data/biomedvis-6gb/ome.xml")
        if ome_xml_file.exists():
            try:
                with open(ome_xml_file, 'r', encoding='utf-8') as f:
                    xml_content = f.read()
                channel_names = extract_channel_names_from_xml(xml_content)
            except Exception as e:
                print(f"Error reading local OME XML: {e}")
    
    # Try method 3: Extract from OME XML URL (if configured)
    # Uncomment and set DATA_URL if you have a URL to fetch OME XML from
    # if not channel_names:
    #     print("\nMethod 3: Trying to extract from OME XML URL...")
    #     try:
    #         import requests
    #         DATA_URL = "https://your-data-source-url.com/ome.xml"
    #         response = requests.get(DATA_URL, timeout=10)
    #         if response.ok:
    #             channel_names = extract_channel_names_from_xml(response.text)
    #     except Exception as e:
    #         print(f"Error fetching OME XML: {e}")
    
    # Update JSON file
    if channel_names:
        update_channel_names_json(channel_names)
        print("\n✓ Channel names successfully updated!")
    else:
        print("\n⚠ Could not extract channel names.")
        print("Please ensure:")
        print("  1. zarr is installed: pip install zarr")
        print("  2. Data path exists: Data/biomedvis-6gb/0/3")
        print("  3. Or provide OME XML file at: Data/biomedvis-6gb/ome.xml")

if __name__ == "__main__":
    main()

