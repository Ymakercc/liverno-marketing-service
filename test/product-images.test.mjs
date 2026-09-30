import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getProductImage, listProductImageModels, normalizeProductModel } from '../src/lib/product-images.mjs';

test('model normalization keeps the complete model as the image key', () => {
  assert.equal(normalizeProductModel(' hdr 60 24 '), 'HDR-60-24');
  assert.equal(normalizeProductModel('GST60A12.png'), 'GST60A12');
});

test('missing model images never fall back to a family banner', () => {
  const result = getProductImage('HDR-60-24', {
    availableImages: {},
  });
  assert.equal(result.imageAvailable, false);
  assert.equal(result.imageUrl, '');
  assert.equal(result.imagePath, '');
  assert.match(result.missingReason, /HDR-60-24/);
});

test('an exact local filename resolves to the matching public image', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-product-images-'));
  try {
    fs.writeFileSync(path.join(directory, 'HDR-60-24.jpg'), 'fixture');
    fs.writeFileSync(path.join(directory, 'LRS.jpg'), 'fixture');
    const result = getProductImage('hdr 60 24', {
      productImageDirectory: directory,
      manifestPath: path.join(directory, 'missing.json'),
      publicBaseUrl: 'https://assets.example.test/email-assets/',
      productImagePublicPath: '/product-images',
    });
    assert.equal(result.imageAvailable, true);
    assert.equal(result.imageUrl, 'https://assets.example.test/email-assets/product-images/HDR-60-24.jpg');
    assert.equal(result.imageLabel, 'HDR-60-24 exact product image');
    assert.deepEqual(listProductImageModels({
      directory,
      manifestPath: path.join(directory, 'missing.json'),
    }), ['HDR-60-24', 'LRS']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a manifest can point an exact model to a public asset', () => {
  const result = getProductImage('LRS-350-24', {
    availableImages: {
      'LRS-350-24': 'https://assets.example.test/models/LRS-350-24.jpg',
    },
  });
  assert.equal(result.imageAvailable, true);
  assert.equal(result.imageUrl, 'https://assets.example.test/models/LRS-350-24.jpg');
  assert.equal(
    result.imagePath,
    'https://assets.example.test/models/LRS-350-24.jpg',
  );
});

test('a concrete base model image can serve a model variant, but a family name cannot', () => {
  const result = getProductImage('LRS-350-24', {
    availableImages: {
      'LRS-350': 'https://assets.example.test/models/LRS-350.png',
      LRS: 'https://assets.example.test/models/LRS.jpg',
    },
  });
  assert.equal(result.imageAvailable, true);
  assert.equal(result.imageSource, 'base_model_asset');
  assert.match(result.imageLabel, /LRS-350/);

  const familyOnly = getProductImage('LRS-350-24', {
    availableImages: { LRS: 'https://assets.example.test/models/LRS.jpg' },
  });
  assert.equal(familyOnly.imageAvailable, false);

  const suffixedBase = getProductImage('HLG-100-24', {
    availableImages: {
      'HLG-100H': 'https://assets.example.test/models/HLG-100H.png',
    },
  });
  assert.equal(suffixedBase.imageAvailable, true);
  assert.equal(suffixedBase.imageSource, 'base_model_asset');
  assert.match(suffixedBase.imageLabel, /HLG-100H/);
});
