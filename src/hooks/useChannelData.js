import { useState, useEffect, useRef } from 'react';
import { CONFIG } from '../config';

// Global cache to persist data across component unmounts
const globalChannelCache = new Map();

/**
 * Utility function to load channel data.
 * Can be used outside of React components or inside useEffects.
 * 
 * @param {number} channelIndex - The index of the channel to load.
 * @returns {Promise<{data: Uint8Array, metadata: Object}|null>}
 */
export const loadChannelData = async (channelIndex) => {
    if (channelIndex === undefined || channelIndex === null) return null;

    // Check cache first
    if (globalChannelCache.has(channelIndex)) {
        return globalChannelCache.get(channelIndex);
    }

    const paths = [
        {
            data: `./${CONFIG.VISUALIZATION_DATA_DIR}/channel_${channelIndex}_napari_data.raw`,
            metadata: `./${CONFIG.VISUALIZATION_DATA_DIR}/channel_${channelIndex}_napari_metadata.json`
        },
        {
            data: `${CONFIG.VISUALIZATION_DATA_DIR}/channel_${channelIndex}_napari_data.raw`,
            metadata: `${CONFIG.VISUALIZATION_DATA_DIR}/channel_${channelIndex}_napari_metadata.json`
        },
        {
            data: `./${CONFIG.VISUALIZATION_DATA_DIR}/channel_${channelIndex}_data.raw`,
            metadata: `./${CONFIG.VISUALIZATION_DATA_DIR}/channel_${channelIndex}_metadata.json`
        },
        {
            data: `${CONFIG.VISUALIZATION_DATA_DIR}/channel_${channelIndex}_data.raw`,
            metadata: `${CONFIG.VISUALIZATION_DATA_DIR}/channel_${channelIndex}_metadata.json`
        }
    ];

    for (const path of paths) {
        try {
            const metadataResponse = await fetch(path.metadata);
            if (!metadataResponse.ok) continue;

            const contentType = metadataResponse.headers.get('content-type');
            if (contentType && !contentType.includes('application/json')) continue;

            const metadataText = await metadataResponse.text();
            if (metadataText.trim().startsWith('<!DOCTYPE') || metadataText.trim().startsWith('<html')) continue;

            const metadata = JSON.parse(metadataText);

            const dataResponse = await fetch(path.data);
            if (!dataResponse.ok) continue;

            const dataContentType = dataResponse.headers.get('content-type');
            if (dataContentType && dataContentType.includes('text/html')) continue;

            const arrayBuffer = await dataResponse.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);

            const result = { data, metadata };

            // Cache the result
            globalChannelCache.set(channelIndex, result);

            return result;
        } catch (error) {
            // Continue to next path on error
            continue;
        }
    }

    console.warn(`Failed to load data for channel ${channelIndex}`);
    return null;
};

/**
 * React hook to load channel data.
 * 
 * @param {number} channelIndex - The index of the channel to load.
 * @returns {{data: Uint8Array|null, metadata: Object|null, loading: boolean, error: Error|null}}
 */
export const useChannelData = (channelIndex) => {
    const [data, setData] = useState(null);
    const [metadata, setMetadata] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;

        if (channelIndex === undefined || channelIndex === null) {
            setData(null);
            setMetadata(null);
            setLoading(false);
            return;
        }

        const fetchData = async () => {
            setLoading(true);
            setError(null);

            try {
                const result = await loadChannelData(channelIndex);

                if (mountedRef.current) {
                    if (result) {
                        setData(result.data);
                        setMetadata(result.metadata);
                    } else {
                        setError(new Error(`Failed to load channel ${channelIndex}`));
                    }
                }
            } catch (err) {
                if (mountedRef.current) {
                    setError(err);
                }
            } finally {
                if (mountedRef.current) {
                    setLoading(false);
                }
            }
        };

        fetchData();

        return () => {
            mountedRef.current = false;
        };
    }, [channelIndex]);

    return { data, metadata, loading, error };
};
