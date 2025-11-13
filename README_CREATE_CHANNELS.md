# How to Create Data Files for All Channels

This guide explains how to create visualization data files for all channels (0-69) so they can be loaded when selected in the ChannelSelection panel.

## Quick Start

1. Open `general.ipynb` in Jupyter
2. Make sure `daskArray` is loaded (from the zarr dataset)
3. Run this code in a new cell:

```python
# Load the script
exec(open('create_all_channels.py').read())

# Create data files for ALL channels (0-69)
# This will take some time - be patient!
create_all_channels_data(daskArray, downsample_factor=1)
```

## Options

### Create All Channels (0-69)
```python
exec(open('create_all_channels.py').read())
create_all_channels_data(daskArray, downsample_factor=1)
```

### Create Specific Channels Only
```python
exec(open('create_all_channels.py').read())
create_specific_channels_data(daskArray, [27, 37, 25, 40, 59], downsample_factor=1)
```

### Create Channels with Downsampling (faster, smaller files)
```python
exec(open('create_all_channels.py').read())
# downsample_factor=2 means 2x downsampling (4x smaller files)
create_all_channels_data(daskArray, downsample_factor=2)
```

### Create Channels in Range
```python
exec(open('create_all_channels.py').read())
# Create channels 0-29
create_all_channels_data(daskArray, downsample_factor=1, start_channel=0, end_channel=29)
```

## What Gets Created

For each channel, two files are created in `visualization_data/`:
- `channel_{N}_metadata.json` - Contains shape, data range, etc.
- `channel_{N}_data.raw` - Binary data file (normalized to 0-255)

## After Creating Files

Once files are created:
1. Refresh your React app
2. In ChannelSelection, you can now select any channel (0-69)
3. The selected channel will automatically load and display in Main_View

## Notes

- Creating all 70 channels will take time and use disk space (~100-200 MB per channel depending on downsampling)
- Files are created sequentially to avoid memory issues
- If a channel has all identical values, it will be skipped
- The script shows progress and summary at the end





