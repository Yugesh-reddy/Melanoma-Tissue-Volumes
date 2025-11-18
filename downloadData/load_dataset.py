#!/usr/bin/env python3
"""
Load BiomedVis Challenge 2025 dataset - Load from local downloaded data
"""

import dask.array as da
import os

def load_biomedvis_data():
    """Load the dataset from locally downloaded files"""
    
    print("🚀 Loading BiomedVis Challenge 2025 dataset...")
    
    # Load from local downloaded data
    local_path = "./biomedvis-6gb/0/3"
    
    # Check if data exists
    if not os.path.exists(local_path):
        raise FileNotFoundError(f"Dataset not found at {local_path}. Please run download_dataset.py first.")
    
    # Load the zarr array from local path
    daskArray = da.from_zarr(local_path)
    
    print("✅ Dataset loaded successfully!")
    print(f"📊 Shape: {daskArray.shape}")
    print(f"📊 Size: {daskArray.nbytes / (1024**3):.2f} GB")
    print(f"📊 Chunks: {daskArray.chunks}")
    print(f"📊 Data type: {daskArray.dtype}")
    
    return daskArray

if __name__ == "__main__":
    daskArray = load_biomedvis_data()
    print(f"\n📊 Array: {daskArray}")
