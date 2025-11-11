#!/usr/bin/env python3
"""
Download BiomedVis Challenge 2025 dataset - Quality 3 (6GB)
"""

import os
import subprocess

def download_biomedvis_dataset():
    """Download the complete 6GB dataset using S3 sync"""
    
    print(" BiomedVis Challenge 2025 - Dataset Downloader")
    print("=" * 50)
    print(" Dataset: Quality 3 (6GB)")
    print(" Output: ./biomedvis-6gb/")
    print("  Time: 2-10 minutes")
    print("-" * 50)
    
    # Create output directory
    os.makedirs("./biomedvis-6gb", exist_ok=True)
    
    # S3 paths
    bucket_path = "s3://lsp-public-data/biomedvis-challenge-2025/Dataset1-LSP13626-melanoma-in-situ/0/3/"
    local_path = "./biomedvis-6gb/0/3/"
    
    print(f" Downloading from: {bucket_path}")
    print(f" Saving to: {local_path}")
    print("\n Starting download...")
    
    try:
        # Use AWS CLI to sync the data - find aws in virtual environment or system
        import sys
        venv_aws = os.path.join(os.path.dirname(sys.executable), "aws")
        aws_cmd = venv_aws if os.path.exists(venv_aws) else "aws"
        
        cmd = [
            aws_cmd, "s3", "sync", 
            bucket_path, local_path, "--no-sign-request"
        ]
        
        # Run the command
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            print("\n Download completed successfully!")
            print(f" Files saved to: {os.path.abspath(local_path)}")
            print(f" Total files: {len(os.listdir(local_path))}")
            
            # Show usage example
            print(f"\n Usage example:")
            print(f"```python")
            print(f"import dask.array as da")
            print(f"")
            print(f"# Load the dataset")
            print(f"daskArray = da.from_zarr('./biomedvis-6gb/0/3')")
            print(f"print(f'Shape: {{daskArray.shape}}')")
            print(f"print(f'Size: {{daskArray.nbytes / (1024**3):.2f}} GB')")
            print(f"```")
            
        else:
            print(f"\n Download failed: {result.stderr}")
            
    except Exception as e:
        print(f"\n Error: {e}")

if __name__ == "__main__":
    download_biomedvis_dataset()
