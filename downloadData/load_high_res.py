#!/usr/bin/env python3
"""
Load BiomedVis Challenge 2025 dataset - Quality 2 (High Resolution ~95GB)
"""

import dask.array as da
from fsspec.core import url_to_fs

def load_high_resolution_data():
    """Load the high resolution dataset using your method"""
    
    print("🚀 Loading BiomedVis Challenge 2025 - High Resolution Dataset...")
    
    # Your exact code for quality 2 (high resolution)
    path = "https://lsp-public-data.s3.amazonaws.com/biomedvis-challenge-2025/Dataset1-LSP13626-melanoma-in-situ/0"
    fs, path = url_to_fs(path)
    store = fs.get_mapper(f"{path}/2")
    daskArray = da.from_zarr(store)
    
    print("✅ High resolution dataset loaded successfully!")
    print(f"📊 Shape: {daskArray.shape}")
    print(f"📊 Size: {daskArray.nbytes / (1024**3):.2f} GB")
    print(f"📊 Chunks: {daskArray.chunks}")
    
    return daskArray

if __name__ == "__main__":
    daskArray = load_high_resolution_data()
    print(f"\n📊 Array: {daskArray}")
