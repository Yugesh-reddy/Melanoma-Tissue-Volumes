#!/usr/bin/env python3
"""
Load BiomedVis Challenge 2025 dataset - Your original code
"""

import dask.array as da
from fsspec.core import url_to_fs

def load_biomedvis_data():
    """Load the dataset using your original method"""
    
    print("🚀 Loading BiomedVis Challenge 2025 dataset...")
    
    # Your exact code
    path = "https://lsp-public-data.s3.amazonaws.com/biomedvis-challenge-2025/Dataset1-LSP13626-melanoma-in-situ/0"
    fs, path = url_to_fs(path)
    store = fs.get_mapper(f"{path}/3")
    daskArray = da.from_zarr(store)
    
    print("✅ Dataset loaded successfully!")
    print(f"📊 Shape: {daskArray.shape}")
    print(f"📊 Size: {daskArray.nbytes / (1024**3):.2f} GB")
    print(f"📊 Chunks: {daskArray.chunks}")
    
    return daskArray

if __name__ == "__main__":
    daskArray = load_biomedvis_data()
    print(f"\n📊 Array: {daskArray}")
