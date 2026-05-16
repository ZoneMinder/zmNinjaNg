/**
 * Secure Image Component
 *
 * An enhanced image component that handles authenticated image loading.
 * It attempts to load images normally first, but can fall back to
 * fetching via the API client (with auth headers) if the standard load fails.
 * This is particularly useful for loading protected resources in a native context.
 */

import { useState, useEffect, useRef } from 'react';
import { Platform } from '../../lib/platform';
import { getApiClient } from '../../api/client';
import { cn } from '../../lib/utils';
import { log, LogLevel } from '../../lib/logger';

interface SecureImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** The source URL of the image */
  src: string;
  /** Optional fallback URL if the primary source fails */
  fallbackSrc?: string;
}

/**
 * SecureImage component.
 * Renders an `img` tag with built-in error handling and authenticated fetch fallback.
 *
 * @param props - Component properties
 * @param props.src - Image source URL
 * @param props.fallbackSrc - Fallback image URL
 * @param props.className - CSS class names
 * @param props.alt - Alt text
 */
export function SecureImage({ src, fallbackSrc, className, alt, ...props }: SecureImageProps) {
  const [imageSrc, setImageSrc] = useState<string>(src);
  const isNative = Platform.isNative;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Cleanup blob URL if we created one
      if (imageSrc && imageSrc.startsWith('blob:')) {
        URL.revokeObjectURL(imageSrc);
      }
    };
  }, []);

  useEffect(() => {
    // Default to using the src directly
    setImageSrc(src);
    
    // Only attempt native fetch if we specifically want to force it or as a fallback
    // For now, we'll rely on the standard img tag behavior which seems to work for the user
    // The native fetch logic is preserved below but disabled by default to fix the regression
  }, [src]);

  /* 
  // Previous logic that forced native fetch - disabled because it caused NSURLErrorDomain errors
  useEffect(() => {
    if (!isNative || !src || !src.startsWith('http')) {
      setImageSrc(src);
      return;
    }
    // ... native fetch logic ...
  }, [src, isNative, fallbackSrc]);
  */

  /**
   * Handles image load errors.
   * Tries authenticated fetch if on native platform, then falls back to fallbackSrc.
   */
  const handleError = async (e: React.SyntheticEvent<HTMLImageElement>) => {
    // If we already tried fallback or native fetch, stop
    if (imageSrc === fallbackSrc) {
      if (props.onError) props.onError(e);
      return;
    }

    // If standard load failed, try native fetch as a backup mechanism
    // This helps with CORS or specific SSL issues that WebView might block but Native might allow
    // (though in this specific case, Native seems to be the one failing)
    if (isNative && src.startsWith('http') && imageSrc === src) {
      try {
        const client = getApiClient();
        const response = await client.get<string>(src, { responseType: 'base64' });
        if (mountedRef.current && response.data) {
          const contentType =
            response.headers['content-type'] ||
            response.headers['Content-Type'] ||
            'image/jpeg';
          setImageSrc(`data:${contentType};base64,${response.data}`);
          return; // Success, don't trigger parent onError yet
        }
      } catch (err) {
        log.secureImage('Native fallback fetch failed', LogLevel.ERROR, err);
      }
    }

    // If native fallback also failed (or wasn't attempted), try the provided fallbackSrc
    if (fallbackSrc && imageSrc !== fallbackSrc) {
      setImageSrc(fallbackSrc);
      return;
    }
    
    // Finally delegate to parent
    if (props.onError) {
      props.onError(e);
    }
  };

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={cn(className)}
      onError={handleError}
      {...props}
    />
  );
}
