"""
Quick script to create data file for Channel 27
Run this in general.ipynb after daskArray is loaded
"""
import json
from pathlib import Path
import numpy as np

def create_channel_27_data(daskArray, downsample_factor=1):
    """Create data file for channel 27"""
    channel_idx = 27
    
    print(f"🚀 Creating data files for Channel {channel_idx}...")
    print(f"{'='*60}")
    
    # Load and downsample
    channel_data = daskArray[0, channel_idx, ::downsample_factor, ::downsample_factor, ::downsample_factor].compute()
    print(f"Shape: {channel_data.shape}")
    
    # Normalize to 0-255
    data_min, data_max = channel_data.min(), channel_data.max()
    print(f"Data range: [{int(data_min):,}, {int(data_max):,}]")
    
    if data_max == data_min:
        print(f"⚠️  All values are the same ({data_min}), cannot create data")
        return None, None
    
    channel_data_norm = ((channel_data - data_min) / (data_max - data_min) * 255).astype(np.uint8)
    
    # Save metadata
    metadata = {
        'shape': list(channel_data.shape),  # Convert tuple to list
        'dataRange': [int(data_min), int(data_max)],
        'downsampleFactor': downsample_factor,
        'channel': channel_idx
    }
    
    output_dir = Path("visualization_data")
    output_dir.mkdir(exist_ok=True)
    
    # Save metadata
    metadata_file = output_dir / f"channel_{channel_idx}_metadata.json"
    with open(metadata_file, 'w') as f:
        json.dump(metadata, f, indent=2)
    
    # Save data as binary
    data_file = output_dir / f"channel_{channel_idx}_data.raw"
    channel_data_norm.tofile(data_file)
    
    file_size_mb = channel_data_norm.nbytes / (1024**2)
    print(f"\n✅ Successfully created:")
    print(f"   - {metadata_file}")
    print(f"   - {data_file}")
    print(f"   - Data size: {file_size_mb:.2f} MB")
    print(f"   - Data range: [{int(data_min):,}, {int(data_max):,}]")
    print(f"\n{'='*60}")
    print(f"🎉 Channel {channel_idx} data files created successfully!")
    print(f"🔄 Refresh your React app to see Channel {channel_idx}!")
    
    return metadata, channel_data_norm

# Usage in notebook:
# exec(open('create_channel_27.py').read())
# metadata_27, data_27 = create_channel_27_data(daskArray, downsample_factor=1)



