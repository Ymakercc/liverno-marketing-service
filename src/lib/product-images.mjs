import fs from 'node:fs';
import path from 'node:path';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const EXTENSION_PRIORITY = ['.jpg', '.jpeg', '.png', '.webp'];
const DEFAULT_DIRECTORY = 'public/assets/product-images';
const DEFAULT_MANIFEST_PATH = 'public/assets/product-images/index.json';
const DEFAULT_PUBLIC_PATH = '/product-images';
const inventoryCache = new Map();

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

/**
 * Model names are the lookup key. Punctuation variants are normalized, but
 * family prefixes are deliberately not used as a fallback.
 */
export function normalizeProductModel(value) {
  return clean(value)
    .normalize('NFKC')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\.(?:jpe?g|png|webp)$/i, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase();
}

function isImageFile(filename) {
  return IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function imageKeyFromFilename(filename) {
  return normalizeProductModel(path.basename(filename, path.extname(filename)));
}

function addInventoryEntry(inventory, model, value, source = 'exact_model_asset') {
  const key = normalizeProductModel(model);
  const target = clean(value);
  if (!key || !target || inventory.has(key)) return;
  inventory.set(key, { value: target, source });
}

function readManifest(manifestPath, inventory) {
  if (!manifestPath || !fs.existsSync(manifestPath)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const models = raw?.models && typeof raw.models === 'object' ? raw.models : raw;
    if (!models || typeof models !== 'object' || Array.isArray(models)) return;
    for (const [model, value] of Object.entries(models)) {
      if (typeof value === 'string') addInventoryEntry(inventory, model, value, 'exact_model_manifest');
    }
  } catch {
    // A malformed optional manifest must not make the marketing service fail.
  }
}

function readDirectory(directory, inventory) {
  if (!directory || !fs.existsSync(directory)) return;
  let files = [];
  try {
    files = fs.readdirSync(directory).filter(isImageFile).sort((left, right) => {
      const leftExt = EXTENSION_PRIORITY.indexOf(path.extname(left).toLowerCase());
      const rightExt = EXTENSION_PRIORITY.indexOf(path.extname(right).toLowerCase());
      return (leftExt - rightExt) || left.localeCompare(right);
    });
  } catch {
    return;
  }
  for (const filename of files) addInventoryEntry(inventory, imageKeyFromFilename(filename), filename);
}

function getInventory({ directory = DEFAULT_DIRECTORY, manifestPath = DEFAULT_MANIFEST_PATH } = {}) {
  const resolvedDirectory = path.resolve(clean(directory) || DEFAULT_DIRECTORY);
  const resolvedManifest = path.resolve(clean(manifestPath) || DEFAULT_MANIFEST_PATH);
  const cacheKey = `${resolvedDirectory}\n${resolvedManifest}`;
  if (inventoryCache.has(cacheKey)) return inventoryCache.get(cacheKey);

  const inventory = new Map();
  readManifest(resolvedManifest, inventory);
  readDirectory(resolvedDirectory, inventory);
  inventoryCache.set(cacheKey, inventory);
  return inventory;
}

function concreteModelAliases(model) {
  const normalized = normalizeProductModel(model);
  const parts = normalized.split('-');
  const last = parts.at(-1) || '';
  const stem = last.match(/^(.*\d)[A-Z]+$/)?.[1];
  return stem ? [normalized, [...parts.slice(0, -1), stem].join('-')] : [normalized];
}

function resolveInventoryEntry(inventory, normalizedModel, allowBaseModelFallback = true) {
  const exact = inventory.get(normalizedModel);
  if (exact) return { entry: exact, matchedModel: normalizedModel, source: exact.source || 'exact_model_asset' };
  if (!allowBaseModelFallback || !normalizedModel) return null;

  const candidates = [];
  for (const [model, entry] of inventory.entries()) {
    for (const alias of concreteModelAliases(model)) {
      if (alias.split('-').length >= 2 && normalizedModel.startsWith(`${alias}-`)) {
        candidates.push({ model, alias, entry });
      }
    }
  }
  candidates.sort((left, right) => (
    right.alias.length - left.alias.length ||
    right.model.length - left.model.length ||
    left.model.localeCompare(right.model)
  ));
  const match = candidates[0];
  if (!match) return null;
  return { entry: match.entry, matchedModel: match.model, source: 'base_model_asset' };
}

function normalizeAvailableImages(availableImages) {
  if (!availableImages) return null;
  const inventory = new Map();
  if (availableImages instanceof Map) {
    for (const [model, value] of availableImages.entries()) {
      if (typeof value === 'string') addInventoryEntry(inventory, model, value);
      else if (value?.value) addInventoryEntry(inventory, model, value.value, value.source);
    }
    return inventory;
  }
  if (Array.isArray(availableImages)) {
    for (const value of availableImages) {
      if (typeof value === 'string') addInventoryEntry(inventory, imageKeyFromFilename(value), value);
    }
    return inventory;
  }
  if (typeof availableImages === 'object') {
    for (const [model, value] of Object.entries(availableImages)) {
      if (typeof value === 'string') addInventoryEntry(inventory, model, value);
      else if (value?.value) addInventoryEntry(inventory, model, value.value, value.source);
    }
  }
  return inventory;
}

function publicAssetPath(value, publicPath) {
  const target = clean(value);
  if (/^https?:\/\//i.test(target)) return target;
  if (target.startsWith('/')) return target;
  return `${publicPath}/${target}`.replace(/\\+/g, '/');
}

function buildImageUrl(value, { publicBaseUrl = '', publicPath = DEFAULT_PUBLIC_PATH } = {}) {
  const target = publicAssetPath(value, clean(publicPath) || DEFAULT_PUBLIC_PATH);
  if (/^https?:\/\//i.test(target)) return target;
  const base = clean(publicBaseUrl).replace(/\/$/, '');
  return base ? `${base}${target}` : `/assets${target}`;
}

export function listProductImageModels(options = {}) {
  return [...getInventory(options).keys()].sort();
}

/**
 * Resolve only a complete model name to its own uploaded image.
 * No family/category/banner fallback is allowed here.
 */
export function getProductImage(model, options = {}) {
  const normalizedModel = normalizeProductModel(model);
  const inventory = normalizeAvailableImages(options.availableImages)
    || getInventory({
      directory: options.productImageDirectory,
      manifestPath: options.productImageManifestPath,
    });
  const resolved = resolveInventoryEntry(
    inventory,
    normalizedModel,
    options.allowBaseModelFallback !== false,
  );
  if (!resolved) {
    return {
      model: normalizedModel,
      imageUrl: '',
      imageLabel: 'Exact model image pending',
      imagePath: '',
      imageAvailable: false,
      imageSource: '',
      missingReason: `缺少 ${normalizedModel || clean(model) || '该型号'} 的具体产品图`,
    };
  }
  const { entry, matchedModel, source } = resolved;
  return {
    model: normalizedModel,
    imageUrl: buildImageUrl(entry.value, {
      publicBaseUrl: options.publicBaseUrl,
      publicPath: options.productImagePublicPath,
    }),
    imageLabel: matchedModel === normalizedModel
      ? `${normalizedModel} exact product image`
      : `${normalizedModel} concrete ${matchedModel} product image`,
    imagePath: publicAssetPath(entry.value, clean(options.productImagePublicPath) || DEFAULT_PUBLIC_PATH),
    imageAvailable: true,
    imageSource: source,
    missingReason: '',
  };
}
