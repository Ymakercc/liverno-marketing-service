const fields = {
  company: document.getElementById('company-name'),
  contact: document.getElementById('contact-name'),
  market: document.getElementById('market-name'),
  previousCount: document.getElementById('previous-count'),
  subject: document.getElementById('email-subject-input'),
  heroTitle: document.getElementById('hero-title'),
  heroHighlight: document.getElementById('hero-highlight'),
  nextStep: document.getElementById('next-step'),
  ctaLabel: document.getElementById('cta-label'),
  intro: document.getElementById('intro-copy'),
  applications: document.getElementById('application-cards'),
  fit: document.getElementById('fit-copy'),
  closing: document.getElementById('closing-copy'),
};

const productQuery = document.getElementById('product-query');
const loadProductsButton = document.getElementById('load-products');
const catalogMeta = document.getElementById('catalog-meta');
const productResults = document.getElementById('product-results');
const selectedProductsBox = document.getElementById('selected-products');
const emailPreview = document.getElementById('email-preview');
const subjectPreview = document.getElementById('subject-preview');
const copyStatus = document.getElementById('copy-status');
const copyRichButton = document.getElementById('copy-rich-email');
const copySourceButton = document.getElementById('copy-html-source');
const salespersonSelect = document.getElementById('salesperson-select');

const selectedProducts = [];
let latestProducts = [];

const defaultModels = ['RSP-500-48', 'RSP-1000-48', 'NDR-240-48', 'SDR-480-48'];

const salespeople = [
  {
    key: 'Brown',
    name: 'Mr. Brown',
    title: 'Product Technical Support',
    avatar: 'https://meanwell.business/sign_images/brown.jpg',
    phone: '',
    email: 'Brown@kulon.com',
    qrUrl: 'https://meanwell.business/sign_images/qr_brown.png',
    wecomUrl: 'https://work.weixin.qq.com/kfid/kfcc453f332b37d7355?enc_scene=ENC87MaFrtTiXmwTNLPTVLNoMC3c6sa7cQtGGu7frPRg8DK',
    qrAlt: 'Contact Brown on WeCom',
  },
  {
    key: 'Beatty',
    name: 'Ms. Beatty',
    title: 'Customer Manager',
    avatar: 'https://meanwell.business/sign_images/beatty.png',
    phone: '+86 181 5718 1719',
    email: 'Beatty@kulon.com',
    qrUrl: 'https://meanwell.business/sign_images/qr_beatty.png',
    wecomUrl: 'https://work.weixin.qq.com/kfid/kfca2d0599296b08d1c?enc_scene=ENCERAzrQSL1L8nn5bU2mX261tHttSWDTTjXfe8h3RrH8ri',
    qrAlt: 'Contact Beatty on WeCom',
  },
  {
    key: 'Amanda',
    name: 'Ms. Amanda',
    title: 'Customer Manager',
    avatar: 'https://meanwell.business/sign_images/amanda.png',
    phone: '+86 181 5718 1752',
    email: 'Amanda@kulon.com',
    qrUrl: 'https://meanwell.business/sign_images/qr_amanda.png',
    wecomUrl: 'https://work.weixin.qq.com/kfid/kfccbfffac6a5d87dbd?enc_scene=ENC3FqvwM2D3otTSF9AQCwWvD88cZu1of9fFSLNssaJHGNe',
    qrAlt: 'Contact Amanda on WeCom',
  },
  {
    key: 'Andrew',
    name: 'Mr. Andrew',
    title: 'Customer Manager KULON',
    avatar: 'https://meanwell.business/sign_images/Andrew.png',
    phone: '+86 181 5718 1769',
    email: 'Andrew@kulon.com',
    qrUrl: 'https://meanwell.business/sign_images/qr_andrew.png',
    wecomUrl: 'https://work.weixin.qq.com/kfid/kfcb3c6044e1f0e261f?enc_scene=ENC46uBcufsCU2YExPBGaVUxKr32rQxxb741Z9vv1GUJ5cz',
    qrAlt: 'Contact Andrew on WeCom',
  },
  {
    key: 'Carla',
    name: 'Ms. Carla',
    title: 'Product Technical Support',
    avatar: 'https://meanwell.business/sign_images/Carla.png',
    phone: '+86 181 5718 1731',
    email: 'Carla@kulon.com',
    qrUrl: 'https://meanwell.business/sign_images/qr_carla.png',
    wecomUrl: 'https://work.weixin.qq.com/kfid/kfcf2ebb545bb8f6284?enc_scene=ENC2xf8GSxpXMZB8c8KNLLg8WbyuNHL9gHhBbjRV8W26juJ',
    qrAlt: 'Contact Carla on WeCom',
  },
  {
    key: 'Charles',
    name: 'Mr. Charles',
    title: 'Customer Manager',
    avatar: 'https://meanwell.business/sign_images/charles.png',
    phone: '+86 181 5718 1761',
    email: 'Charles@kulon.com',
    qrUrl: 'https://meanwell.business/sign_images/qr_charles.png',
    wecomUrl: 'https://work.weixin.qq.com/kfid/kfc3213d65521260f6c',
    qrAlt: 'Contact Charles on WeCom',
  },
  {
    key: 'Chloe',
    name: 'Ms. Chloe',
    title: 'Customer Manager',
    avatar: 'https://meanwell.business/sign_images/chloe.png',
    phone: '+86 181 5718 1732',
    email: 'Chloe@kulon.com',
    qrUrl: 'https://meanwell.business/sign_images/qr_chloe.png',
    wecomUrl: 'https://work.weixin.qq.com/kfid/kfcfe2f8dd5b4e99ef4?enc_scene=ENCF55oHsEKeLz3CSPsdYSgWFSuFbZNs5e2GSNGWhCwBW9j',
    qrAlt: 'Contact Chloe on WeCom',
  },
  {
    key: 'Rick',
    name: 'Mr. Rick',
    title: 'Product Technical Support',
    avatar: 'https://meanwell.business/sign_images/rick.png',
    phone: '+86 181 5718 1783',
    email: 'Rick@kulon.com',
    qrUrl: 'https://meanwell.business/sign_images/qr_rick.png',
    wecomUrl: 'https://work.weixin.qq.com/kfid/kfc8b47e7c95ec0b0d5?enc_scene=ENCFNQu7qXcm1xxQMK7J8v7hT8MkPwr1ZPgpKdEVQ2S7MqU',
    qrAlt: 'Contact Rick on WeCom',
  },
  {
    key: 'Monica',
    name: 'Ms. Monica',
    title: 'Customer Manager',
    avatar: 'https://meanwell.business/sign_images/monica.png',
    phone: '+86 181 5718 1759',
    email: 'Monica@kulon.com',
    qrUrl: 'https://meanwell.business/sign_images/qr_monica.png',
    wecomUrl: 'https://work.weixin.qq.com/kfid/kfc91fd84ba24e3584a?enc_scene=ENCxziF8qhhf2KAu4o4Q7p95bHYoytNYZ97J5mGeUgbztp',
    qrAlt: 'Contact Monica on WeCom',
  },
  {
    key: 'Eric',
    name: 'Mr. Eric',
    title: 'Customer Manager KULON',
    avatar: 'https://meanwell.business/sign_images/eric.png',
    phone: '+86 181 5718 1751',
    email: 'Eric@kulon.com',
    qrUrl: 'https://meanwell.business/sign_images/qr_eric.png',
    wecomUrl: 'https://work.weixin.qq.com/kfid/kfc1d95a27f4dd623e1?enc_scene=ENC4rpKSqEsYkQ7babiUjVHACopNf6rWsGvmhnU98s33rEx',
    qrAlt: 'Contact Eric on WeCom',
  },
  {
    key: 'Alice',
    name: 'Ms. Alice',
    title: 'Customer Manager KULON',
    avatar: 'https://meanwell.business/sign_images/Alice.png',
    phone: '+86 181 5718 1781',
    email: 'Alice@kulon.com',
    qrUrl: 'https://meanwell.business/sign_images/qr_alice.png',
    wecomUrl: 'https://work.weixin.qq.com/kfid/kfcc46c76dac688972c?enc_scene=ENC7hFpxNAXhvFsL8fEhGBS65PtHfh7ZysKXk2XrYiaEZXJ',
    qrAlt: 'Contact Alice on WeCom',
  },
  {
    key: 'Helen',
    name: 'Ms. Helen',
    title: 'Product Technical support KULON',
    avatar: 'https://meanwell.business/sign_images/Helen.png',
    phone: '+86 181 5719 6682',
    email: 'Helen@kulon.com',
    qrUrl: 'https://meanwell.business/sign_images/qr_helen.png',
    wecomUrl: 'https://work.weixin.qq.com/kfid/kfc6e3d423be8e14c1a?enc_scene=ENC5YV2W5ZdpB6HzcaRDo38YXW2Rgy6xcPJBSZp2nLLDoYa',
    qrAlt: 'Contact Helen on WeCom',
  },
];

const signatureAssets = {
  backgroundUrl: 'https://meanwell.business/sign_images/BG%402x.png?v=20260904',
  kulonLogo: 'https://meanwell.business/sign_images/KULON%402x.png?v=20260904',
};

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function selectedSalesperson() {
  return salespeople.find((person) => person.key === salespersonSelect.value) || salespeople[0];
}

function populateSalespersonSelect() {
  salespersonSelect.innerHTML = salespeople.map((person) => (
    `<option value="${escapeAttribute(person.key)}">${escapeHtml(person.name)} · ${escapeHtml(person.title)}</option>`
  )).join('');
  salespersonSelect.value = salespeople[0]?.key || '';
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function formatPrice(product) {
  const price = Number(product.price);
  if (!Number.isFinite(price)) return 'Price on request';
  return `${escapeHtml(product.currency || 'USD')} ${price.toFixed(2)} / PC`;
}

function paragraphs(value) {
  return clean(value)
    .split(/\n{2,}/)
    .map((part) => clean(part).replace(/\n/g, ' '))
    .filter(Boolean)
    .map((part) => `<p style="margin:0 0 16px 0; color:#263940; font-size:16px; line-height:26px;">${escapeHtml(part)}</p>`)
    .join('');
}

function applicationCards() {
  const fallback = [
    ['Application fit', 'Power supply options selected around the customer application.'],
    ['Technical review', 'Model, output, enclosure and certification can be checked before quotation.'],
    ['Quotation support', 'Price, lead time and destination can be confirmed case by case.'],
  ];
  const rows = clean(fields.applications.value)
    .split('\n')
    .map((line) => line.split('|').map(clean))
    .filter((parts) => parts[0])
    .slice(0, 3);
  const cards = (rows.length ? rows : fallback).map(([title, detail]) => ({
    title,
    detail: detail || 'Selected based on the customer application and sourcing requirement.',
  }));

  return cards.map((card, index) => {
    const padding = index === 0 ? '0 7px 0 0' : index === 1 ? '0 7px' : '0 0 0 7px';
    return `<td width="33.33%" style="padding:${padding}; vertical-align:top;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; border-collapse:collapse; border:1px solid #dce8e9; background:#f8fbfb;">
        <tr>
          <td style="padding:18px 16px;">
            <div style="font-size:11px; line-height:15px; color:#2ea85e; font-weight:800; text-transform:uppercase;">${escapeHtml(card.title)}</div>
            <div style="padding-top:8px; color:#0d3640; font-size:17px; line-height:22px; font-weight:800;">${escapeHtml(card.detail.split('.')[0])}</div>
            <div style="padding-top:8px; color:#536970; font-size:13px; line-height:20px;">${escapeHtml(card.detail)}</div>
          </td>
        </tr>
      </table>
    </td>`;
  }).join('');
}

function productFitCopy(product) {
  const category = clean(product.category) || 'Power supply';
  if (/DIN/i.test(category)) return 'For control panels, monitoring cabinets and auxiliary circuits where DIN-rail mounting is easier.';
  if (/Enclosed/i.test(category)) return 'For auxiliary loads, cabinet power and project equipment where enclosed construction is preferred.';
  if (/LED/i.test(category)) return 'For lighting projects where a stable LED driver option needs to be reviewed with the fixture requirement.';
  if (/Adapter/i.test(category)) return 'For finished equipment or external power applications where adapter format is preferred.';
  if (/PCB|open/i.test(category)) return 'For compact equipment and internal integration where board-level power needs to be checked.';
  if (/UPS|backup/i.test(category)) return 'For backup power, battery-related equipment and service support applications.';
  return 'For project sourcing where model, output, price and availability need to be checked together.';
}

function salespersonSignatureHtml(person) {
  const phoneLine = person.phone ? `<div style="margin: 0; line-height: 20px; white-space: nowrap;"><span style="color: #555555;">Whatsapp/Wechat: </span><span style="color: #2ba64b;">${escapeHtml(person.phone)}</span></div>` : '';
  return `<div style="margin: 0; padding: 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="width: 640px; border-collapse: collapse; font-family: Calibri, Arial, sans-serif;">
      <tbody>
        <tr>
          <td style="padding: 20px; width: 600px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" height="280" background="${signatureAssets.backgroundUrl}" style="width: 600px; height: 280px; border-collapse: collapse; background-color: #ffffff; background-image: url('${signatureAssets.backgroundUrl}'); background-repeat: no-repeat; background-position: 0 0; background-size: 600px 280px;">
              <tbody>
                <tr style="height: 106px;">
                  <td colspan="2" style="height: 106px; padding: 0; vertical-align: top;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="360" style="width: 360px; border-collapse: collapse;">
                      <tbody>
                        <tr>
                          <td width="48" style="width: 48px; padding: 0;">&nbsp;</td>
                          <td width="90" style="width: 90px; padding: 15px 0 0; vertical-align: top;"><img src="${escapeAttribute(person.avatar)}" width="90" height="90" alt="${escapeAttribute(person.avatarAlt)}" style="display: block; width: 90px; height: 90px; border: 0;"></td>
                          <td width="22" style="width: 22px; padding: 0;">&nbsp;</td>
                          <td width="200" style="width: 200px; padding: 40px 0 0; vertical-align: top; color: #373737;">
                            <div style="font-size: 21px; line-height: 25px; font-weight: bold; white-space: nowrap;">${escapeHtml(person.name)}</div>
                            <div style="margin-top: 4px; font-size: 14px; line-height: 18px; white-space: nowrap;">${escapeHtml(person.title)}</div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                  <td rowspan="2" width="232" height="212" style="width: 232px; height: 212px; padding: 0; vertical-align: top;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="232" height="212" style="width: 232px; height: 212px; border-collapse: collapse;">
                      <tbody>
                        <tr><td height="89" style="height: 89px; padding: 0; font-size: 1px; line-height: 1px;">&nbsp;</td></tr>
                        <tr>
                          <td height="123" style="height: 123px; padding: 0; vertical-align: top;">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="209" style="width: 209px; margin-left: 2px; border-collapse: collapse;">
                              <tbody>
                                <tr height="23">
                                  <td width="21" height="21" style="width: 21px; height: 21px; border: 1px solid #27a53c; color: #27a53c; font-family: Arial, sans-serif; font-size: 19px; line-height: 21px; font-weight: bold; text-align: center;">f</td>
                                  <td width="4" style="width: 4px; font-size: 1px; line-height: 1px;">&nbsp;</td>
                                  <td width="180" style="width: 180px; padding: 0; vertical-align: middle;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="180" height="16" style="width: 180px; height: 16px; border-collapse: collapse; background-color: #27a53c; border-radius: 9px;">
                                      <tr>
                                        <td style="padding-left: 9px; white-space: nowrap;"><a href="https://www.facebook.com/KulonSMPS" target="_blank" rel="noopener" style="color: #ffffff; font-family: Arial, sans-serif; font-size: 8px; line-height: 16px; font-weight: bold; text-decoration: none;">facebook.com/KulonSMPS</a></td>
                                        <td width="18" style="width: 18px; padding-right: 1px; text-align: center;"><a href="https://www.facebook.com/KulonSMPS" target="_blank" rel="noopener" style="display: block; width: 14px; height: 14px; background-color: #ffffff; border-radius: 8px; color: #27a53c; font-family: Arial, sans-serif; font-size: 9px; line-height: 14px; text-decoration: none;">&#8599;</a></td>
                                      </tr>
                                    </table>
                                  </td>
                                </tr>
                                <tr><td colspan="3" height="4" style="height: 4px; font-size: 1px; line-height: 1px;">&nbsp;</td></tr>
                                <tr height="23">
                                  <td width="21" height="21" style="width: 21px; height: 21px; border: 1px solid #27a53c; color: #27a53c; font-family: Arial, sans-serif; font-size: 13px; line-height: 21px; font-weight: bold; text-align: center;">in</td>
                                  <td width="4" style="width: 4px; font-size: 1px; line-height: 1px;">&nbsp;</td>
                                  <td width="180" style="width: 180px; padding: 0; vertical-align: middle;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="180" height="16" style="width: 180px; height: 16px; border-collapse: collapse; background-color: #27a53c; border-radius: 9px;">
                                      <tr>
                                        <td style="padding-left: 9px; white-space: nowrap;"><a href="https://www.linkedin.com/company/kulon" target="_blank" rel="noopener" style="color: #ffffff; font-family: Arial, sans-serif; font-size: 8px; line-height: 16px; font-weight: bold; text-decoration: none;">linkedin.com/company/kulon</a></td>
                                        <td width="18" style="width: 18px; padding-right: 1px; text-align: center;"><a href="https://www.linkedin.com/company/kulon" target="_blank" rel="noopener" style="display: block; width: 14px; height: 14px; background-color: #ffffff; border-radius: 8px; color: #27a53c; font-family: Arial, sans-serif; font-size: 9px; line-height: 14px; text-decoration: none;">&#8599;</a></td>
                                      </tr>
                                    </table>
                                  </td>
                                </tr>
                                <tr><td colspan="3" height="4" style="height: 4px; font-size: 1px; line-height: 1px;">&nbsp;</td></tr>
                                <tr height="23">
                                  <td width="21" height="21" style="width: 21px; height: 21px; border: 1px solid #27a53c; color: #27a53c; font-family: Arial, sans-serif; font-size: 8px; line-height: 9px; font-weight: bold; text-align: center;">You<br>Tube</td>
                                  <td width="4" style="width: 4px; font-size: 1px; line-height: 1px;">&nbsp;</td>
                                  <td width="180" style="width: 180px; padding: 0; vertical-align: middle;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="180" height="16" style="width: 180px; height: 16px; border-collapse: collapse; background-color: #27a53c; border-radius: 9px;">
                                      <tr>
                                        <td style="padding-left: 9px; white-space: nowrap;"><a href="https://www.youtube.com/@MEANWELL-KULON" target="_blank" rel="noopener" style="color: #ffffff; font-family: Arial, sans-serif; font-size: 8px; line-height: 16px; font-weight: bold; text-decoration: none;">youtube.com/@MEANWELL-KULON</a></td>
                                        <td width="18" style="width: 18px; padding-right: 1px; text-align: center;"><a href="https://www.youtube.com/@MEANWELL-KULON" target="_blank" rel="noopener" style="display: block; width: 14px; height: 14px; background-color: #ffffff; border-radius: 8px; color: #27a53c; font-family: Arial, sans-serif; font-size: 9px; line-height: 14px; text-decoration: none;">&#8599;</a></td>
                                      </tr>
                                    </table>
                                  </td>
                                </tr>
                                <tr><td colspan="3" height="4" style="height: 4px; font-size: 1px; line-height: 1px;">&nbsp;</td></tr>
                                <tr><td colspan="3" style="padding: 0;"><img src="${signatureAssets.kulonLogo}" width="209" height="19" alt="Hangzhou Kulon Electronics Co., Ltd." style="display: block; width: 209px; height: 19px; border: 0;"></td></tr>
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
                <tr style="height: 106px;">
                  <td width="278" style="width: 278px; height: 106px; padding: 0; vertical-align: top;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="278" style="width: 278px; border-collapse: collapse;">
                      <tbody>
                        <tr>
                          <td width="43" style="width: 43px; padding: 0;">&nbsp;</td>
                          <td style="padding: 0; color: #555555; font-size: 13px;">
                            ${phoneLine}
                            <div style="margin: 0; line-height: 20px; white-space: nowrap;"><span style="color: #555555;">E-mail: </span><span style="color: #2ba64b;"><a href="mailto:${escapeAttribute(person.email)}" target="_blank" rel="noopener" style="color: #2ba64b; text-decoration: none;">${escapeHtml(person.email)}</a></span></div>
                            <div style="margin: 0; line-height: 20px; white-space: nowrap;"><span style="color: #555555;">Website: </span><span style="color: #2ba64b;"><a href="https://www.meanwell-led.com/" target="_blank" rel="noopener" style="color: #2ba64b; text-decoration: none;">www.meanwell-led.com</a></span></div>
                            <div style="margin: 0; line-height: 20px; white-space: nowrap;"><span style="color: #555555;">Website: </span><span style="color: #2ba64b;"><a href="https://www.meanwell-smps.com/" target="_blank" rel="noopener" style="color: #2ba64b; text-decoration: none;">www.meanwell-smps.com</a></span></div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                  <td width="90" style="width: 90px; height: 106px; padding: 0; vertical-align: top; text-align: center;">
                    <a href="${escapeAttribute(person.wecomUrl)}" target="_blank" rel="noopener" style="display: block; text-decoration: none;"><img src="${escapeAttribute(person.qrUrl)}" width="68" height="68" alt="${escapeAttribute(person.qrAlt)}" style="display: block; width: 68px; height: 68px; margin: 3px auto 0; border: 0;"></a>
                  </td>
                </tr>
                <tr style="height: 68px;"><td colspan="3" style="height: 68px; padding: 0; font-size: 1px; line-height: 1px;">&nbsp;</td></tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  </div><div style="height: 16px; line-height: 16px; font-size: 1px;">&nbsp;</div>`;
}

function productCards() {
  if (!selectedProducts.length) {
    return `<tr>
      <td style="padding:22px; color:#536970; background:#f8fbfb; border:1px dashed #b7cbd0; font-size:14px; line-height:22px;">
        Select products on the left to insert real model images and prices from the marketing catalog.
      </td>
    </tr>`;
  }

  const cells = selectedProducts.slice(0, 8).map((product, index) => {
    const left = index % 2 === 0;
    const bottom = index >= selectedProducts.length - (selectedProducts.length % 2 || 2) ? '8px' : '16px';
    return `<td width="50%" style="padding:0 ${left ? '8px' : '0'} ${bottom} ${left ? '0' : '8px'}; vertical-align:top;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; border-collapse:collapse; border:1px solid #d6e3e5;">
        <tr>
          <td align="center" style="padding:18px; background:#f3f7f7;">
            <img src="${escapeAttribute(product.imageUrl)}" width="230" alt="MEAN WELL ${escapeAttribute(product.model)}" style="display:block; width:230px; max-width:100%; height:auto; border:0;">
          </td>
        </tr>
        <tr>
          <td style="padding:18px;">
            <div style="font-size:11px; line-height:15px; color:#6c7c82; font-weight:800; text-transform:uppercase;">${escapeHtml(product.category)}</div>
            <div style="padding-top:6px; color:#082f39; font-size:22px; line-height:27px; font-weight:800;">${escapeHtml(product.model)}</div>
            <div style="padding-top:8px; color:#118f42; font-size:13px; line-height:18px; font-weight:800;">${formatPrice(product)} · ${escapeHtml(product.availability || 'In Stock')}</div>
            <div style="padding-top:8px; color:#465b62; font-size:14px; line-height:22px;">${escapeHtml(productFitCopy(product))}</div>
          </td>
        </tr>
      </table>
    </td>`;
  });

  const rows = [];
  for (let index = 0; index < cells.length; index += 2) {
    rows.push(`<tr>${cells[index]}${cells[index + 1] || '<td width="50%" style="padding:0 0 8px 8px;">&nbsp;</td>'}</tr>`);
  }
  return rows.join('');
}

function previousContactText() {
  const count = Math.max(Number(fields.previousCount.value) || 0, 0);
  if (!count) return 'First contact';
  if (count === 1) return '1 note shared';
  return `${count} notes shared`;
}

function greeting() {
  const contact = clean(fields.contact.value);
  const company = clean(fields.company.value) || 'your team';
  return contact ? `Dear ${contact},` : `Dear ${company} Team,`;
}

function buildEmailHtml() {
  const company = clean(fields.company.value) || 'your customer';
  const market = clean(fields.market.value) || 'your market';
  const mailtoSubject = encodeURIComponent(clean(fields.subject.value) || `MEAN WELL shortlist for ${company}`);

  return `<table id="email-content" role="presentation" cellpadding="0" cellspacing="0" border="0" width="720" style="width:720px; max-width:720px; border-collapse:collapse; background:#ffffff; font-family:Arial, Helvetica, sans-serif; color:#10242b;">
    <tr>
      <td style="padding:0; background:#ffffff;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; border-collapse:collapse;">
          <tr>
            <td width="50%" style="padding:22px 36px 16px 36px; vertical-align:middle;">
              <img src="https://meanwell.business/email_images/meanwell-kulon-logo.png" width="190" alt="MEAN WELL KULON" style="display:block; width:190px; max-width:190px; height:auto; border:0;">
              <div style="padding-top:6px; font-size:11px; line-height:15px; color:#49616a; font-weight:700;">MEAN WELL Global Authorized Distributor</div>
            </td>
            <td width="50%" align="right" style="padding:22px 36px 16px 20px; vertical-align:middle; color:#0c3a45; font-size:12px; line-height:18px; letter-spacing:0; text-transform:uppercase;">MEAN WELL POWER SUPPLY SOLUTIONS</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0; background-color:#07344b;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; border-collapse:collapse;">
          <tr>
            <td style="padding:42px 38px; background:#05273a;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; border-collapse:collapse;">
                <tr>
                  <td width="68%" style="vertical-align:top; padding-right:28px;">
                    <div style="font-size:12px; line-height:16px; color:#8af5a7; font-weight:800; text-transform:uppercase;">Focused follow-up for ${escapeHtml(company)}</div>
                    <h1 style="margin:14px 0 12px 0; color:#ffffff; font-size:31px; line-height:38px; font-weight:800; letter-spacing:0;">${escapeHtml(fields.heroTitle.value)}<br><span style="color:#73e88e;">${escapeHtml(fields.heroHighlight.value)}</span></h1>
                    <p style="margin:0; color:#dce9ed; font-size:15px; line-height:24px;">A practical shortlist for ${escapeHtml(market)} applications, project sourcing and repeat enquiries.</p>
                  </td>
                  <td width="32%" style="vertical-align:top; border-left:1px solid rgba(255,255,255,0.18); padding-left:26px;">
                    <div style="font-size:11px; line-height:15px; color:#9fc2cb; text-transform:uppercase;">Previous contact</div>
                    <div style="padding:7px 0 18px 0; font-size:18px; line-height:22px; color:#ffffff; font-weight:800;">${escapeHtml(previousContactText())}</div>
                    <div style="font-size:11px; line-height:15px; color:#9fc2cb; text-transform:uppercase;">Next step</div>
                    <div style="padding-top:7px; font-size:18px; line-height:22px; color:#ffffff; font-weight:800;">${escapeHtml(fields.nextStep.value)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td style="height:5px; background:#43b96d; font-size:0; line-height:0;">&nbsp;</td></tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:34px 38px 10px 38px; background:#ffffff;">
        <p style="margin:0 0 22px 0; color:#053b39; font-size:20px; line-height:26px; font-weight:800;">${escapeHtml(greeting())}</p>
        ${paragraphs(fields.intro.value)}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; border-collapse:collapse; margin:24px 0;"><tr>${applicationCards()}</tr></table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 38px 8px 38px; background:#ffffff;">
        <div style="font-size:12px; line-height:16px; color:#2ea85e; font-weight:800; text-transform:uppercase;">Suggested starting models</div>
        <h2 style="margin:8px 0 14px 0; color:#07344b; font-size:24px; line-height:30px; font-weight:800; letter-spacing:0;">A compact shortlist for ${escapeHtml(company)}</h2>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; border-collapse:collapse;">${productCards()}</table>
      </td>
    </tr>
    <tr>
      <td style="padding:22px 38px 34px 38px; background:#ffffff;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%; border-collapse:collapse; background:#07344b;">
          <tr>
            <td style="padding:24px 26px;">
              <div style="color:#8af5a7; font-size:12px; line-height:16px; font-weight:800; text-transform:uppercase;">Why this may fit ${escapeHtml(company)}</div>
              <p style="margin:10px 0 0 0; color:#ffffff; font-size:16px; line-height:26px;">${escapeHtml(fields.fit.value)}</p>
            </td>
          </tr>
        </table>
        <p style="margin:24px 0 22px 0; color:#263940; font-size:16px; line-height:26px;">${escapeHtml(fields.closing.value)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td style="background:#2fbf68;">
              <a href="mailto:sales@kulon.com?subject=${mailtoSubject}" style="display:inline-block; padding:13px 22px; color:#ffffff; text-decoration:none; font-size:15px; line-height:20px; font-weight:800;">${escapeHtml(fields.ctaLabel.value)}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 38px 36px 38px; background:#ffffff;">
        <p style="margin:22px 0 0 0; color:#263940; font-size:15px; line-height:22px;">Best regards,</p>
        ${salespersonSignatureHtml(selectedSalesperson())}
      </td>
    </tr>
  </table>`;
}

function renderEmail() {
  const subject = clean(fields.subject.value) || 'MEAN WELL power supply shortlist';
  subjectPreview.textContent = `Subject: ${subject}`;
  emailPreview.innerHTML = buildEmailHtml();
}

function renderSelectedProducts() {
  if (!selectedProducts.length) {
    selectedProductsBox.innerHTML = '<div class="catalog-meta">还没有选择产品。搜索型号后点击“加入邮件”。</div>';
    return;
  }
  selectedProductsBox.innerHTML = selectedProducts.map((product) => `
    <div class="selected-item">
      <div>
        <strong>${escapeHtml(product.model)}</strong>
        <span>${escapeHtml(product.category)} · ${formatPrice(product)} · ${escapeHtml(product.availability || 'In Stock')}</span>
      </div>
      <button type="button" data-remove="${escapeAttribute(product.model)}">移除</button>
    </div>
  `).join('');
}

function addProduct(product) {
  if (!product?.model || selectedProducts.some((item) => item.model === product.model)) return;
  if (selectedProducts.length >= 8) {
    setCopyStatus('最多建议选择 8 个产品，邮件长度会比较稳。', 'error');
    return;
  }
  selectedProducts.push(product);
  renderSelectedProducts();
  renderEmail();
}

function removeProduct(model) {
  const index = selectedProducts.findIndex((item) => item.model === model);
  if (index >= 0) selectedProducts.splice(index, 1);
  renderSelectedProducts();
  renderEmail();
}

function renderProductResults(products) {
  if (!products.length) {
    productResults.innerHTML = '<div class="catalog-meta">没有找到带产品图的报价型号。可以换一个系列关键词试试。</div>';
    return;
  }
  productResults.innerHTML = products.map((product) => `
    <article class="product-card">
      <img src="${escapeAttribute(product.imageUrl)}" alt="${escapeAttribute(product.model)}">
      <div>
        <strong>${escapeHtml(product.model)}</strong>
        <span>${escapeHtml(product.category)}</span>
        <span>${formatPrice(product)} · ${escapeHtml(product.availability || 'In Stock')}</span>
        <button type="button" data-add="${escapeAttribute(product.model)}">加入邮件</button>
      </div>
    </article>
  `).join('');
}

async function fetchProducts(query = '', limit = 80) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set('q', query);
  const response = await fetch(`/api/public/email-products?${params}`);
  if (!response.ok) throw new Error(`产品接口返回 ${response.status}`);
  return response.json();
}

async function loadProducts(query = productQuery.value) {
  catalogMeta.textContent = '正在读取产品数据...';
  try {
    const data = await fetchProducts(clean(query), 80);
    latestProducts = data.products || [];
    renderProductResults(latestProducts);
    const pricing = data.pricing || {};
    catalogMeta.textContent = `报价目录：${pricing.entryCount || 0} 个型号；邮件币种：${pricing.emailCurrency || 'USD'}；当前显示：${latestProducts.length} 个带图型号。`;
  } catch (error) {
    latestProducts = [];
    productResults.innerHTML = '';
    catalogMeta.textContent = `产品数据读取失败：${error.message}`;
  }
}

async function loadDefaultProducts() {
  try {
    const results = await Promise.all(defaultModels.map((model) => fetchProducts(model, 5).catch(() => ({ products: [] }))));
    for (const result of results) {
      const product = result.products?.[0];
      if (product) addProduct(product);
    }
  } catch {
    // The regular search list is still useful if default prefill fails.
  }
}

function currentEmailHtml() {
  const content = emailPreview.querySelector('#email-content');
  return content ? content.outerHTML.trim() : buildEmailHtml();
}

function setCopyStatus(message, tone = 'normal') {
  copyStatus.textContent = message;
  copyStatus.className = `copy-status ${tone === 'success' ? 'success' : tone === 'error' ? 'error' : ''}`.trim();
}

async function copyTextFallback(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  if (!ok) throw new Error('浏览器拒绝复制');
}

async function copyRichFallback(html) {
  const container = document.createElement('div');
  container.contentEditable = 'true';
  container.style.position = 'fixed';
  container.style.top = '-1000px';
  container.style.left = '-1000px';
  container.style.opacity = '0';
  container.innerHTML = html;
  document.body.appendChild(container);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(container);
  selection.removeAllRanges();
  selection.addRange(range);
  const ok = document.execCommand('copy');
  selection.removeAllRanges();
  container.remove();
  if (!ok) throw new Error('浏览器拒绝复制');
}

async function writeClipboard({ html, text, rich = false }) {
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the legacy DOM copy path below.
  }
  if (rich) {
    await copyRichFallback(html);
    return;
  }
  await copyTextFallback(text);
}

async function copyRichEmail() {
  const html = currentEmailHtml();
  const plain = (emailPreview.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  await writeClipboard({ html, text: plain || html, rich: true });
}

Object.values(fields).forEach((field) => {
  field.addEventListener('input', renderEmail);
});
salespersonSelect.addEventListener('change', renderEmail);

loadProductsButton.addEventListener('click', () => loadProducts());
productQuery.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    loadProducts();
  }
});

productResults.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-add]');
  if (!button) return;
  const product = latestProducts.find((item) => item.model === button.dataset.add);
  addProduct(product);
});

selectedProductsBox.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-remove]');
  if (!button) return;
  removeProduct(button.dataset.remove);
});

copyRichButton.addEventListener('click', async () => {
  try {
    await copyRichEmail();
    setCopyStatus('已复制图文邮件，可直接粘贴到邮箱正文或 EDM 编辑器。', 'success');
  } catch (error) {
    setCopyStatus(`复制失败：${error.message}`, 'error');
  }
});

copySourceButton.addEventListener('click', async () => {
  try {
    const html = currentEmailHtml();
    await writeClipboard({ html, text: html, rich: false });
    setCopyStatus('已复制 HTML 源码。', 'success');
  } catch (error) {
    setCopyStatus(`复制失败：${error.message}`, 'error');
  }
});

populateSalespersonSelect();
renderSelectedProducts();
renderEmail();
loadProducts('RSP');
loadDefaultProducts();
