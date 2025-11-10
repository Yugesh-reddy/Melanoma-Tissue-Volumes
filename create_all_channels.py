"""
Script to create data files for ALL channels (0-69)
This should be run in general.ipynb after loading the daskArray

Usage in notebook:
    exec(open('create_all_channels.py').read())
    create_all_channels_data(daskArray, downsample_factor=1)
"""
import json
from pathlib import Path
import numpy as np

def create_all_channels_data(daskArray, downsample_factor=1, start_channel=0, end_channel=69):
    """
    Create data files for all channels from start_channel to end_channel
    
    Args:
        daskArray: The dask array loaded from zarr (should be available in notebook)
        downsample_factor: Downsampling factor (1 = no downsampling, higher = more downsampling)
        start_channel: First channel index (default: 0)
        end_channel: Last channel index (default: 69)
    """
    output_dir = Path("visualization_data")
    output_dir.mkdir(exist_ok=True)
    
    successful = []
    failed = []
    
    print(f"\n{'='*70}")
    print(f"Creating data files for channels {start_channel} to {end_channel}")
    print(f"Downsample factor: {downsample_factor}")
    print(f"{'='*70}\n")
    
    for channel_idx in range(start_channel, end_channel + 1):
        print(f"\n[{channel_idx}/{end_channel}] Processing Channel {channel_idx}...")
        
        try:
            # Load and downsample
            channel_data = daskArray[0, channel_idx, ::downsample_factor, ::downsample_factor, ::downsample_factor].compute()
            print(f"  Shape: {channel_data.shape}")
            
            # Normalize to 0-255
            data_min, data_max = channel_data.min(), channel_data.max()
            
            if data_max == data_min:
                print(f"  ⚠️  Channel {channel_idx}: All values are the same ({data_min}), skipping")
                failed.append((channel_idx, "All values are the same"))
                continue
            
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
            
            file_size_mb = channel_data_norm.nbytes / (1024**2)
            print(f"  ✅ Successfully created:")
            print(f"     - {metadata_file.name}")
            print(f"     - {data_file.name}")
            print(f"     - Data size: {file_size_mb:.2f} MB")
            print(f"     - Data range: [{int(data_min):,}, {int(data_max):,}]")
            
            successful.append(channel_idx)
            
        except Exception as e:
            print(f"  ❌ Error creating channel {channel_idx}: {str(e)}")
            failed.append((channel_idx, str(e)))
            continue
    
    # Summary
    print(f"\n{'='*70}")
    print(f"✅ FINISHED!")
    print(f"{'='*70}")
    print(f"Successfully created: {len(successful)}/{end_channel - start_channel + 1} channels")
    print(f"Failed: {len(failed)} channels")
    
    if successful:
        print(f"\n✅ Successful channels: {successful[:10]}{'...' if len(successful) > 10 else ''}")
    
    if failed:
        print(f"\n❌ Failed channels:")
        for channel_idx, error in failed[:10]:
            print(f"   Channel {channel_idx}: {error}")
        if len(failed) > 10:
            print(f"   ... and {len(failed) - 10} more")
    
    print(f"\n{'='*70}\n")
    
    return successful, failed

# Alternative: Create data files for specific channels only
def create_specific_channels_data(daskArray, channel_indices, downsample_factor=1):
    """
    Create data files for specific channels only
    
    Args:
        daskArray: The dask array loaded from zarr
        channel_indices: List of channel indices to create (e.g., [27, 37, 25, 40, 59])
        downsample_factor: Downsampling factor (1 = no downsampling)
    """
    output_dir = Path("visualization_data")
    output_dir.mkdir(exist_ok=True)
    
    successful = []
    failed = []
    
    print(f"\n{'='*70}")
    print(f"Creating data files for channels: {channel_indices}")
    print(f"Downsample factor: {downsample_factor}")
    print(f"{'='*70}\n")
    
    for channel_idx in channel_indices:
        print(f"\nProcessing Channel {channel_idx}...")
        
        try:
            # Load and downsample
            channel_data = daskArray[0, channel_idx, ::downsample_factor, ::downsample_factor, ::downsample_factor].compute()
            print(f"  Shape: {channel_data.shape}")
            
            # Normalize to 0-255
            data_min, data_max = channel_data.min(), channel_data.max()
            
            if data_max == data_min:
                print(f"  ⚠️  Channel {channel_idx}: All values are the same ({data_min}), skipping")
                failed.append((channel_idx, "All values are the same"))
                continue
            
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
            
            file_size_mb = channel_data_norm.nbytes / (1024**2)
            print(f"  ✅ Successfully created:")
            print(f"     - {metadata_file.name}")
            print(f"     - {data_file.name}")
            print(f"     - Data size: {file_size_mb:.2f} MB")
            print(f"     - Data range: [{int(data_min):,}, {int(data_max):,}]")
            
            successful.append(channel_idx)
            
        except Exception as e:
            print(f"  ❌ Error creating channel {channel_idx}: {str(e)}")
            failed.append((channel_idx, str(e)))
            continue
    
    # Summary
    print(f"\n{'='*70}")
    print(f"✅ FINISHED!")
    print(f"{'='*70}")
    print(f"Successfully created: {len(successful)}/{len(channel_indices)} channels")
    print(f"Failed: {len(failed)} channels")
    
    if successful:
        print(f"\n✅ Successful channels: {successful}")
    
    if failed:
        print(f"\n❌ Failed channels:")
        for channel_idx, error in failed:
            print(f"   Channel {channel_idx}: {error}")
    
    print(f"\n{'='*70}\n")
    
    return successful, failed



