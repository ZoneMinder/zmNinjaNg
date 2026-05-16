/**
 * QR Scanner Component
 *
 * A dialog-based QR code scanner that uses:
 * - Native barcode scanning on iOS/Android (capacitor-barcode-scanner)
 * - Web-based scanning on desktop (html5-qrcode)
 *
 * Used for scanning profile QR codes to import ZoneMinder server configurations.
 *
 * Note: html5-qrcode manipulates DOM directly, so we create the scanner container
 * outside of React's virtual DOM to avoid reconciliation conflicts.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Platform } from '../lib/platform';
import type { Html5Qrcode as Html5QrcodeType } from 'html5-qrcode';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Camera, CameraOff, Loader2, AlertCircle, ImageIcon } from 'lucide-react';
import { log, LogLevel } from '../lib/logger';

interface QRScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (data: string) => void;
}

const SCANNER_ID = 'qr-scanner-region';

// Scanner state constants (from html5-qrcode)
const SCANNER_STATE = {
  NOT_STARTED: 0,
  SCANNING: 1,
  PAUSED: 2,
};

export function QRScanner({ open, onOpenChange, onScan }: QRScannerProps) {
  const { t } = useTranslation();
  const scannerRef = useRef<Html5QrcodeType | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scannerReady, setScannerReady] = useState(false);
  const isNative = Platform.isNative;

  // Create scanner container outside React's control
  const createScannerElement = useCallback(() => {
    if (!wrapperRef.current) return null;

    // Remove any existing scanner element
    const existing = document.getElementById(SCANNER_ID);
    if (existing) {
      existing.remove();
    }

    // Create new element
    const scannerEl = document.createElement('div');
    scannerEl.id = SCANNER_ID;
    scannerEl.style.width = '100%';
    scannerEl.style.height = '100%';
    wrapperRef.current.appendChild(scannerEl);

    return scannerEl;
  }, []);

  // Remove scanner container
  const removeScannerElement = useCallback(() => {
    const existing = document.getElementById(SCANNER_ID);
    if (existing) {
      existing.remove();
    }
  }, []);

  // Cleanup scanner
  const cleanupScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState();
        if (state === SCANNER_STATE.SCANNING || state === SCANNER_STATE.PAUSED) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch (e) {
        log.profile('Error cleaning up QR scanner', LogLevel.WARN, e);
      }
      scannerRef.current = null;
    }
    removeScannerElement();
    setScannerReady(false);
  }, [removeScannerElement]);

  // Handle dialog close
  const handleClose = useCallback(async () => {
    if (!isNative) {
      await cleanupScanner();
    }
    setError(null);
    setHasPermission(null);
    setScannerReady(false);
    setNativeScannerLaunched(false);
    setIsStarting(false);
    setIsProcessingFile(false);
    onOpenChange(false);
  }, [isNative, cleanupScanner, onOpenChange]);

  // Native scanner for iOS/Android
  const startNativeScanner = useCallback(async () => {
    setIsStarting(true);
    setError(null);
    setNativeScannerLaunched(true);

    try {
      const { BarcodeScanner } = await import('capacitor-barcode-scanner');
      setIsStarting(false);

      const result = await BarcodeScanner.scan();

      if (result.result && result.code) {
        log.profile('QR code scanned (native)', LogLevel.INFO);
        onScan(result.code);
        onOpenChange(false);
      } else {
        // User cancelled - go back to selection UI
        setNativeScannerLaunched(false);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      log.profile('Native QR scanner failed', LogLevel.ERROR, e);

      setNativeScannerLaunched(false);
      if (
        errorMessage.toLowerCase().includes('permission') ||
        errorMessage.toLowerCase().includes('denied') ||
        errorMessage.toLowerCase().includes('camera')
      ) {
        setHasPermission(false);
        setError('camera_permission_denied');
      } else {
        setError('camera_error');
      }
      setIsStarting(false);
    }
  }, [onScan, onOpenChange]);

  // Web scanner for desktop browsers
  const startWebScanner = useCallback(async () => {
    setIsStarting(true);
    setError(null);
    setScannerReady(false);

    try {
      // Clean up any existing scanner first
      await cleanupScanner();

      // Wait for wrapper to be ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create scanner element outside React
      const element = createScannerElement();
      if (!element) {
        throw new Error('Scanner wrapper not found');
      }

      // Dynamic import
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode(SCANNER_ID);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        async (decodedText) => {
          log.profile('QR code scanned (web)', LogLevel.INFO);
          await cleanupScanner();
          onScan(decodedText);
          onOpenChange(false);
        },
        () => {
          // Continuous scan failure - ignore
        }
      );

      setScannerReady(true);
      setHasPermission(true);
      setIsStarting(false);
      log.profile('Web QR scanner started', LogLevel.INFO);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      log.profile('Web QR scanner failed to start', LogLevel.ERROR, e);

      // Clean up on error
      removeScannerElement();

      if (
        errorMessage.includes('Permission') ||
        errorMessage.includes('NotAllowedError') ||
        errorMessage.includes('denied')
      ) {
        setHasPermission(false);
        setError('camera_permission_denied');
      } else if (errorMessage.includes('NotFoundError') || errorMessage.includes('no camera')) {
        setError('camera_not_found');
      } else {
        setError('camera_error');
      }
      setIsStarting(false);
    }
  }, [onScan, onOpenChange, cleanupScanner, createScannerElement, removeScannerElement]);

  const startScanner = useCallback(async () => {
    if (isNative) {
      await startNativeScanner();
    } else {
      await startWebScanner();
    }
  }, [isNative, startNativeScanner, startWebScanner]);

  // Handle file selection for QR code scanning from image
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsProcessingFile(true);
      setError(null);

      // Create a temporary hidden element for the scanner
      const tempElementId = 'file-scanner-temp';
      let tempElement: HTMLDivElement | null = null;

      try {
        // Create temporary element in DOM (required by html5-qrcode)
        tempElement = document.createElement('div');
        tempElement.id = tempElementId;
        tempElement.style.display = 'none';
        document.body.appendChild(tempElement);

        const { Html5Qrcode } = await import('html5-qrcode');
        const scanner = new Html5Qrcode(tempElementId);
        const result = await scanner.scanFile(file, false);
        log.profile('QR code scanned from file', LogLevel.INFO);
        onScan(result);
        onOpenChange(false);
      } catch (err) {
        log.profile('Failed to scan QR code from file', LogLevel.WARN, err);
        setError('no_qr_in_file');
      } finally {
        // Clean up temporary element
        if (tempElement && tempElement.parentNode) {
          tempElement.parentNode.removeChild(tempElement);
        }
        setIsProcessingFile(false);
        // Reset file input so the same file can be selected again
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [onScan, onOpenChange]
  );

  // Trigger file input click
  const handleLoadFromFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Reset state when dialog opens to ensure clean slate
  useEffect(() => {
    if (open) {
      log.profile('QR scanner dialog opened', LogLevel.DEBUG, { isNative });
      setError(null);
      setIsStarting(false);
      setIsProcessingFile(false);
      setNativeScannerLaunched(false);
    }
  }, [open, isNative]);

  // Start scanner when dialog opens (only for web - native shows selection UI first)
  useEffect(() => {
    if (open && !isNative) {
      const timer = setTimeout(() => {
        startScanner();
      }, 300);
      return () => clearTimeout(timer);
    }
    // On native, we show selection UI first - user chooses camera or photo
  }, [open, isNative, startScanner]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!isNative) {
        // Force cleanup
        if (scannerRef.current) {
          try {
            scannerRef.current.stop().catch(() => {});
            scannerRef.current.clear();
          } catch (error) {
            log.profileForm('QR scanner cleanup failed', LogLevel.DEBUG, { error });
          }
          scannerRef.current = null;
        }
        removeScannerElement();
      }
    };
  }, [isNative, removeScannerElement]);

  // Track if native scanner has been launched (to show selection UI first)
  const [nativeScannerLaunched, setNativeScannerLaunched] = useState(false);

  // For native platforms, show selection UI first, then hide dialog when scanner is active
  if (isNative && nativeScannerLaunched && !error) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(newOpen) => !newOpen && handleClose()}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="qr-scanner-dialog"
        aria-describedby="qr-scanner-description"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            {t('qr_scanner.title')}
          </DialogTitle>
          <DialogDescription id="qr-scanner-description">
            {t('qr_scanner.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Scanner wrapper - the actual scanner element is created dynamically (web only) */}
          {!isNative && !error && (
            <div
              ref={wrapperRef}
              className="relative w-full aspect-square bg-muted rounded-lg overflow-hidden"
              data-testid="qr-scanner-viewport"
            >
              {(isStarting || !scannerReady) && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted z-10">
                  <div className="text-center space-y-2">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{t('qr_scanner.starting')}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error display */}
          {error && !isStarting && (
            <div className="flex items-center justify-center bg-muted rounded-lg p-6">
              <div className="text-center space-y-3">
                {hasPermission === false ? (
                  <CameraOff className="h-12 w-12 mx-auto text-destructive" />
                ) : (
                  <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
                )}
                <p className="text-sm text-destructive font-medium">
                  {t(`qr_scanner.errors.${error}`)}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={isNative ? startNativeScanner : startScanner}
                  data-testid="qr-scanner-retry"
                >
                  {t('qr_scanner.retry')}
                </Button>
              </div>
            </div>
          )}

          {!isNative && !error && (
            <p className="text-xs text-center text-muted-foreground">{t('qr_scanner.hint')}</p>
          )}

          {/* Hidden file input for image selection */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
            data-testid="qr-scanner-file-input"
          />

          {/* Native: Scan with Camera button */}
          {isNative && !error && (
            <Button
              className="w-full"
              onClick={startNativeScanner}
              disabled={isStarting}
              data-testid="qr-scanner-camera"
            >
              {isStarting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('qr_scanner.starting')}
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4 mr-2" />
                  {t('qr_scanner.scan_with_camera')}
                </>
              )}
            </Button>
          )}

          {/* Load from file button */}
          <Button
            variant={isNative ? 'outline' : 'outline'}
            className="w-full"
            onClick={handleLoadFromFile}
            disabled={isProcessingFile}
            data-testid="qr-scanner-load-file"
          >
            {isProcessingFile ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('qr_scanner.processing_file')}
              </>
            ) : (
              <>
                <ImageIcon className="h-4 w-4 mr-2" />
                {t('qr_scanner.load_from_file')}
              </>
            )}
          </Button>

          <Button
            variant="outline"
            className="w-full"
            onClick={handleClose}
            data-testid="qr-scanner-cancel"
          >
            {t('common.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
