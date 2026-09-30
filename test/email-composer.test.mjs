import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEmailHtml,
  buildFirstTouchEmailHtml,
  buildFirstTouchEmailText,
  buildSecondTouchEmailHtml,
  buildSecondTouchEmailText,
  buildSecondTouchSubject,
  buildEmailSignatureHtml,
  getPublicSignature,
} from '../src/lib/email-composer.mjs';

const sales = {
  teamName: 'MEAN WELL KULON TEAM',
  email: 'Sales@kulon.com',
  companyName: 'Hangzhou Kulon Electronics Co.,Ltd.',
  website: 'https://meanwell-led.com/',
  logoUrl: 'https://cdn.shopify.com/kulon-logo.png',
  signatureBackgroundUrl: 'https://meanwell.business/sign_images/bgc.png',
};

test('email signature uses the approved team identity and public links', () => {
  const signature = getPublicSignature(sales);
  const html = buildEmailSignatureHtml(sales);

  assert.equal(signature.websiteLabel, 'meanwell-led.com');
  assert.match(html, /MEAN WELL KULON TEAM/);
  assert.match(html, /mailto:Sales@kulon\.com/);
  assert.match(html, /https:\/\/meanwell-led\.com\//);
  assert.match(html, /https:\/\/meanwell\.business\/sign_images\/bgc\.png/);
  assert.doesNotMatch(html, /WhatsApp|WeChat|Mr\. Brown/i);
});

test('email HTML escapes editable body content before appending the signature', () => {
  const html = buildEmailHtml({
    body: 'Dear Customer,\n<script>alert("x")</script>',
    sales,
  });

  assert.match(html, /Dear Customer,<br>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Sales@kulon\.com/);
});

test('first-touch HTML uses the approved layout around AI copy', () => {
  const html = buildFirstTouchEmailHtml({
    body: 'Dear Buyer,\n\nWe can review your requirement and suggest suitable categories.',
    sales,
    customer: { companyName: 'Example Power', country: 'India' },
    contact: { name: 'Buyer' },
    pricedProducts: [
      { model: 'LRS-350-24', price: 105, currency: 'CNY', availability: 'In Stock' },
      {
        model: 'HDR-60-24', price: 63, currency: 'CNY', availability: 'In Stock',
        imageUrl: 'https://assets.example.test/hdr-60-24.jpg',
        imageLabel: 'DIN-rail representative image',
      },
    ],
    priceListDate: '2026-08-29',
  });

  assert.match(html, /KULON/);
  assert.match(html, /https:\/\/cdn\.shopify\.com\/kulon-logo\.png/);
  assert.match(html, /background:#fff;border-bottom:1px solid #dbe6e1/);
  assert.match(html, /Selected MEAN WELL/);
  assert.match(html, /3000\+/);
  assert.match(html, /What you can expect/);
  assert.match(html, /Dear Buyer,/);
  assert.match(html, /We can review your requirement/);
  assert.match(html, /LRS-350-24/);
  assert.match(html, /https:\/\/assets\.example\.test\/hdr-60-24\.jpg/);
  assert.match(html, /DIN-rail representative image/);
  assert.match(html, /CNY \/ PC/);
  assert.match(html, /In Stock/);
  assert.match(html, /Request a better quotation/);
  assert.doesNotMatch(html, /Dear Buyer,.*Dear Buyer,/s);
  assert.match(html, /mailto:Sales@kulon\.com\?subject=MEAN%20WELL%20distributor%20quotation/);
});

test('first-touch HTML prefers the English country name', () => {
  const html = buildFirstTouchEmailHtml({
    body: 'Industrial power supply support.',
    sales,
    customer: { companyName: 'Example Power', country: '土耳其', countryEnglish: 'Turkey' },
    contact: { name: 'Buyer' },
  });
  assert.match(html, /Example Power in Turkey/);
  assert.doesNotMatch(html, /土耳其/);
});

test('first-touch output removes CJK-only market labels and contact greetings', () => {
  const input = {
    body: 'Dear 黄至诚,\n\nIndustrial power supply support for your applications.',
    sales,
    customer: { companyName: 'Example Power', country: '法国' },
    contact: { name: '黄至诚' },
    pricedProducts: [{ model: 'LRS-350-24', price: 15.31, currency: 'USD', availability: 'In Stock' }],
  };
  const html = buildFirstTouchEmailHtml(input);
  const text = buildFirstTouchEmailText(input);
  assert.doesNotMatch(html, /[\u3400-\u9fff\uf900-\ufaff]/);
  assert.doesNotMatch(text, /[\u3400-\u9fff\uf900-\ufaff]/);
  assert.match(html, /USD 15\.31/);
  assert.match(text, /USD 15\.31/);
});

test('second-touch output uses four products, USD references, and no tracking language', () => {
  const input = {
    sales,
    customer: { companyName: 'Apex Controls', country: '印度', countryEnglish: 'India' },
    contact: { name: 'Raj' },
    draft: { industry: 'Industrial automation' },
    pricedProducts: Array.from({ length: 6 }, (_, index) => ({
      model: `MODEL-${index + 1}`,
      price: 10 + index,
      currency: 'USD',
      availability: 'In Stock',
      imageUrl: `https://assets.example.test/model-${index + 1}.png`,
    })),
    priceListDate: '2026-08-29',
  };
  const subject = buildSecondTouchSubject(input);
  const html = buildSecondTouchEmailHtml(input);
  const text = buildSecondTouchEmailText(input);

  assert.equal(subject, 'A short MEAN WELL shortlist for Apex Controls');
  assert.doesNotMatch(html, /FOLLOW-UP|SECOND TOUCH|Focused model selection/i);
  assert.match(html, /A shorter list/);
  assert.match(html, /MODEL-4/);
  assert.doesNotMatch(html, /MODEL-5/);
  assert.match(html, /USD 10\.00/);
  assert.match(html, /In Stock/);
  assert.doesNotMatch(`${subject}\n${html}\n${text}`, /opened|tracking|\u6253\u5f00/i);
  assert.doesNotMatch(`${subject}\n${html}\n${text}`, /[\u3400-\u9fff\uf900-\ufaff]/);
});
