"""
Script to create missing channel data files for visualization
Run this in the same directory as general.ipynb after loading the daskArray
"""
import json
from pathlib import Path
import numpy as np

def create_channel_data(daskArray, channel_indices, downsample_factor=1):
    """
    Create data files for multiple channels
    
    Args:
        daskArray: The dask array loaded from zarr (should be available in notebook)
        channel_indices: List of channel indices to create (e.g., [27, 37, 25, 40, 59])
        downsample_factor: Downsampling factor (1 = no downsampling)
    """
    output_dir = Path("visualization_data")
    output_dir.mkdir(exist_ok=True)
    
    for channel_idx in channel_indices:
        print(f"\n{'='*60}")
        print(f"Creating data for Channel {channel_idx}")
        print(f"{'='*60}")
        
        try:
            # Load and downsample
            channel_data = daskArray[0, channel_idx, ::downsample_factor, ::downsample_factor, ::downsample_factor].compute()
            print(f"Shape: {channel_data.shape}")
            
            # Normalize to 0-255
            data_min, data_max = channel_data.min(), channel_data.max()
            channel_data_norm = ((channel_data - data_min) / (data_max - data_min) * 255).astype(np.uint8)
            
            # Save metadata
            metadata = {
                'shape': channel_data.shape.tolist(),
                'dataRange': [int(data_min), int(data_max)],
                'downsampleFactor': downsample_factor,
                'channel': channel_idx
            }
            
            # Save metadata
            metadata_file = output_dir / f"channel_{channel_idx}_metadata.json"
            with open(metadata_file, 'w') as f:
                json.dump(metadata, f, indent=2)
            
            # Save data as binary
            data_file = output_dir / f"channel_{channel_idx}_data.raw"
            channel_data_norm.tofile(data_file)
            
            print(f"✅ Successfully created:")
            print(f"   - {metadata_file}")
            print(f"   - {data_file}")
            print(f"   Data size: {channel_data_norm.nbytes / (1024**2):.2f} MB")
            print(f"   Data range: [{int(data_min)}, {int(data_max)}]")
            
        except Exception as e:
            print(f"❌ Error creating channel {channel_idx}: {e}")
            continue
    
    print(f"\n{'='*60}")
    print("✅ Finished creating channel data files!")
    print(f"{'='*60}")

# Example usage in notebook:
# create_channel_data(daskArray, [27, 37, 25, 40, 59], downsample_factor=1)



