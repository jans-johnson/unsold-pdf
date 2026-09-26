import { WasmProvider } from '../utils/wasm-provider';

export type WasmPackage = 'ghostscript' | 'pymupdf' | 'cpdf';

export function getWasmBaseUrl(packageName: WasmPackage): string | undefined {
  const userUrl = WasmProvider.getUrl(packageName);
  if (userUrl) {
    console.log(
      `[WASM Config] Using configured URL for ${packageName}: ${userUrl}`
    );
    return userUrl;
  }

  console.warn(
    `[WASM Config] No URL configured for ${packageName}. Feature unavailable.`
  );
  return undefined;
}

export function isWasmAvailable(packageName: WasmPackage): boolean {
  return WasmProvider.isConfigured(packageName);
}
