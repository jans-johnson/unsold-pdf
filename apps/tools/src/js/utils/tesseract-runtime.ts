import Tesseract from 'tesseract.js';
import { findToolHost } from '@unsold/bridge/tool-host';
import {
  assertTesseractLanguagesAvailable,
  TESSERACT_AVAILABLE_LANGUAGES_ENV_KEY,
} from './tesseract-language-availability.js';

const TESSERACT_ENV_KEYS = [
  'VITE_TESSERACT_WORKER_URL',
  'VITE_TESSERACT_CORE_URL',
  'VITE_TESSERACT_LANG_URL',
] as const;

const TESSERACT_RUNTIME_ENV_KEYS = [
  ...TESSERACT_ENV_KEYS,
  TESSERACT_AVAILABLE_LANGUAGES_ENV_KEY,
] as const;

type TesseractRuntimeEnvKey = (typeof TESSERACT_RUNTIME_ENV_KEYS)[number];

export type TesseractAssetEnv = Partial<
  Pick<ImportMetaEnv, TesseractRuntimeEnvKey>
>;

export interface TesseractAssetConfig {
  workerPath?: string;
  corePath?: string;
  langPath?: string;
}

export type TesseractLoggerMessage = Tesseract.LoggerMessage;
export type TesseractWorkerOptions = Partial<Tesseract.WorkerOptions>;
export type TesseractWorker = Tesseract.Worker;

function getDefaultTesseractAssetEnv(): TesseractAssetEnv {
  return import.meta.env;
}

function normalizeDirectoryUrl(url?: string): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '');
}

function normalizeFileUrl(url?: string): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '');
}

export function resolveTesseractAssetConfig(
  env: TesseractAssetEnv = getDefaultTesseractAssetEnv()
): TesseractAssetConfig {
  return {
    workerPath: normalizeFileUrl(env.VITE_TESSERACT_WORKER_URL),
    corePath: normalizeDirectoryUrl(env.VITE_TESSERACT_CORE_URL),
    langPath: normalizeDirectoryUrl(env.VITE_TESSERACT_LANG_URL),
  };
}

export function hasConfiguredTesseractOverrides(
  config: TesseractAssetConfig = resolveTesseractAssetConfig()
): boolean {
  return Boolean(config.workerPath || config.corePath || config.langPath);
}

export function hasCompleteTesseractOverrides(
  config: TesseractAssetConfig = resolveTesseractAssetConfig()
): boolean {
  return Boolean(config.workerPath && config.corePath && config.langPath);
}

export function getIncompleteTesseractOverrideKeys(
  config: TesseractAssetConfig = resolveTesseractAssetConfig()
): Array<(typeof TESSERACT_ENV_KEYS)[number]> {
  if (!hasConfiguredTesseractOverrides(config)) {
    return [];
  }

  return TESSERACT_ENV_KEYS.filter((key) => {
    switch (key) {
      case 'VITE_TESSERACT_WORKER_URL':
        return !config.workerPath;
      case 'VITE_TESSERACT_CORE_URL':
        return !config.corePath;
      case 'VITE_TESSERACT_LANG_URL':
        return !config.langPath;
    }
  });
}

/** Languages whose OCR data ships inside the app (see scripts/engines.mjs). */
export const BUNDLED_OCR_LANGUAGES = new Set(['eng']);

/**
 * Inside the app, the OCR engine and bundled language data are served from
 * /wasm/tesseract, so recognising those languages works offline.
 */
export function bundledTesseractAssets(
  language: string,
  inApp: boolean = findToolHost() !== null
): TesseractAssetConfig | null {
  if (!inApp) return null;
  const langs = language.split('+').filter(Boolean);
  if (!langs.length || !langs.every((l) => BUNDLED_OCR_LANGUAGES.has(l))) {
    return null;
  }
  const base = new URL(`${import.meta.env.BASE_URL}wasm/tesseract/`, location.href);
  return {
    workerPath: new URL('worker.min.js', base).href,
    corePath: new URL('core', base).href,
    langPath: new URL('lang', base).href,
  };
}

export function buildTesseractWorkerOptions(
  logger?: TesseractWorkerOptions['logger'],
  env: TesseractAssetEnv = getDefaultTesseractAssetEnv(),
  language?: string
): TesseractWorkerOptions {
  const config = resolveTesseractAssetConfig(env);

  if (!hasConfiguredTesseractOverrides(config)) {
    const bundled = language ? bundledTesseractAssets(language) : null;
    if (bundled) return { ...(logger ? { logger } : {}), ...bundled, gzip: true };
    return logger ? { logger } : {};
  }

  if (!hasCompleteTesseractOverrides(config)) {
    const missing = getIncompleteTesseractOverrideKeys(config).join(', ');
    throw new Error(
      `Self-hosted OCR assets are partially configured. Set ${missing} together with the other Tesseract asset URLs.`
    );
  }

  return {
    ...(logger ? { logger } : {}),
    workerPath: config.workerPath,
    corePath: config.corePath,
    langPath: config.langPath,
    gzip: true,
  };
}

export async function createConfiguredTesseractWorker(
  language: string,
  oem: Tesseract.OEM,
  logger?: TesseractWorkerOptions['logger'],
  env: TesseractAssetEnv = getDefaultTesseractAssetEnv()
): Promise<TesseractWorker> {
  assertTesseractLanguagesAvailable(language, env);

  return Tesseract.createWorker(
    language,
    oem,
    buildTesseractWorkerOptions(logger, env, language)
  );
}
