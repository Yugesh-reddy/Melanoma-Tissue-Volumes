#!/usr/bin/env python3
"""
Download BiomedVis Challenge 2025 dataset - Quality 2 (High Resolution ~95GB)
"""

import os
import subprocess

def download_high_resolution_dataset():
    """Download the complete 95GB high resolution dataset using S3 sync"""
    
    print(" BiomedVis Challenge 2025 - High Resolution Dataset Downloader")
    print("=" * 60)
    print(" Dataset: Quality 2 (High Resolution ~95GB)")
    print(" Output: ./biomedvis-high-res/")
    print("  Time: 80-160 minutes")
    print("-" * 60)
    
    # Create output directory
    os.makedirs("./biomedvis-high-res", exist_ok=True)
    
    # S3 paths for quality 2
    bucket_path = "s3://lsp-public-data/biomedvis-challenge-2025/Dataset1-LSP13626-melanoma-in-situ/0/2/"
    local_path = "./biomedvis-high-res/0/2/"
    
    print(f" Downloading from: {bucket_path}")
    print(f" Saving to: {local_path}")
    print("\n Starting download...")
    
    try:
        # Use AWS CLI to sync the data
        cmd = [
            "python", "-m", "awscli", "s3", "sync", 
            bucket_path, local_path, "--no-sign-request"
        ]
        
        # Run the command
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            print("\n High resolution download completed successfully!")
            print(f" Files saved to: {os.path.abspath(local_path)}")
            print(f" Total files: {len(os.listdir(local_path))}")
            
            # Show usage example
            print(f" Usage example:")
            print(f"```python")
            print(f"import dask.array as da")
            print(f"")
            print(f"# Load the high resolution dataset")
            print(f"daskArray = da.from_zarr('./biomedvis-high-res/0/2')")
            print(f"print(f'Shape: {{daskArray.shape}}')")
            print(f"print(f'Size: {{daskArray.nbytes / (1024**3):.2f}} GB')")
            print(f"```")
            
        else:
            print(f"\n Download failed: {result.stderr}")
            
    except Exception as e:
        print(f"\n Error: {e}")

if __name__ == "__main__":
    download_high_resolution_dataset()
