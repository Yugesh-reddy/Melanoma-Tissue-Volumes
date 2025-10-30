# BiomedVis Challenge 2025 - Dataset Downloader

Complete script for downloading and loading BiomedVis Challenge 2025 dataset

## 🚀 Quick Start

### Install packages:
```bash
pip install -r requirements.txt
```

### Download and load quality 3 (recommended):
```bash
python biomedvis_downloader.py --quality 3 --show-metadata
```

### Download and load quality 2 (high resolution):
```bash
python biomedvis_downloader.py --quality 2 --show-metadata
```

### Load only from S3 (without downloading):
```bash
python biomedvis_downloader.py --quality 3 --load-only --show-metadata
```

## 📊 Quality Information

- **Quality 2**: Shape (1, 70, 194, 1377, 2727) - Size ~95 GB
- **Quality 3**: Shape (1, 70, 194, 688, 1363) - Size ~24 GB

## 💻 Python Code for Usage:

```python
import dask.array as da
from fsspec.core import url_to_fs

# Load quality 3
path = "https://lsp-public-data.s3.amazonaws.com/biomedvis-challenge-2025/Dataset1-LSP13626-melanoma-in-situ/0"
fs, path = url_to_fs(path)
store = fs.get_mapper(f"{path}/3")
daskArray = da.from_zarr(store)

print(f"Shape: {daskArray.shape}")
```

## 📁 Local Data Loading

After downloading, you can load data from local files:

```bash
python load_local_data.py --quality 3 --show-metadata
```

## 🔧 Available Options:

### For biomedvis_downloader.py:
- `--quality {2,3}`: Select quality level (default: 3)
- `--output-dir`: Output directory (default: ./biomedvis-data)
- `--download-only`: Only download metadata
- `--load-only`: Only load from S3
- `--show-metadata`: Show complete metadata

### For load_local_data.py:
- `--data-dir`: Directory containing downloaded data (default: ./biomedvis-data)
- `--quality {2,3}`: Quality level to load (default: 3)
- `--show-metadata`: Show detailed metadata
