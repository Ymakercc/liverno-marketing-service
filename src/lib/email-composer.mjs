function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function containsCjk(value) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ''));
}

function outboundLabel(value, fallback = '') {
  const text = String(value || '').trim();
  return text && !containsCjk(text) ? text : fallback;
}

function normalizeWebsite(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function websiteLabel(value) {
  const website = normalizeWebsite(value);
  if (!website) return '';
  const url = new URL(website);
  return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`.replace(/\/$/, '');
}

export function getPublicSignature(sales) {
  return {
    teamName: sales.teamName,
    email: sales.email,
    companyName: sales.companyName,
    website: normalizeWebsite(sales.website),
    websiteLabel: websiteLabel(sales.website),
    backgroundUrl: normalizeWebsite(sales.signatureBackgroundUrl),
  };
}

export function buildEmailSignatureHtml(sales) {
  const signature = getPublicSignature(sales);
  const teamName = escapeHtml(signature.teamName);
  const email = escapeHtml(signature.email);
  const website = escapeHtml(signature.website);
  const websiteText = escapeHtml(signature.websiteLabel);
  const background = escapeHtml(signature.backgroundUrl);

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;border-collapse:collapse;font-family:Calibri,Arial,sans-serif">
  <tr>
    <td width="600" height="280" background="${background}" style="width:600px;height:280px;padding:0;vertical-align:top;background-color:#fff;background-image:url('${background}');background-position:center;background-repeat:no-repeat;background-size:600px 280px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;height:280px;border-collapse:collapse">
        <tr>
          <td height="42" colspan="2" style="height:42px;font-size:0;line-height:0">&nbsp;</td>
        </tr>
        <tr>
          <td width="46" style="width:46px;font-size:0;line-height:0">&nbsp;</td>
          <td style="padding:0;vertical-align:top">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
              <tr>
                <td width="4" height="24" style="width:4px;height:24px;background-color:#36a656;font-size:0;line-height:0">&nbsp;</td>
                <td style="padding:0 0 0 12px;color:#111;font-size:19px;line-height:24px;font-weight:700;white-space:nowrap">${teamName}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td height="26" colspan="2" style="height:26px;font-size:0;line-height:0">&nbsp;</td>
        </tr>
        <tr>
          <td width="62" style="width:62px;font-size:0;line-height:0">&nbsp;</td>
          <td style="padding:0;vertical-align:top">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;color:#4d565c;font-size:13px;line-height:20px">
              <tr>
                <td width="58" style="width:58px;padding:0;color:#4d565c;font-weight:700">Email</td>
                <td style="padding:0"><a href="mailto:${email}" style="color:#288f49;font-weight:600;text-decoration:none">${email}</a></td>
              </tr>
              <tr>
                <td width="58" style="width:58px;padding:0;color:#4d565c;font-weight:700">Website</td>
                <td style="padding:0"><a href="${website}" target="_blank" style="color:#288f49;font-weight:600;text-decoration:none">${websiteText}</a></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td height="148" colspan="2" style="height:148px;font-size:0;line-height:0">&nbsp;</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();
}

export function buildEmailHtml({ body, sales }) {
  const message = escapeHtml(body).replaceAll('\n', '<br>');
  return `<!doctype html><html><body style="margin:0;padding:0;background:#fff"><div style="padding:20px;color:#252b2f;font-family:Calibri,Arial,sans-serif;font-size:15px;line-height:1.6"><div style="max-width:680px">${message}</div><div style="height:16px;line-height:16px">&nbsp;</div>${buildEmailSignatureHtml(sales)}</div></body></html>`;
}

function stripGeneratedGreeting(body) {
  return String(body || '')
    .trim()
    .replace(/^dear\s+[^,\n]{1,120},?\s*/i, '')
    .trim();
}

function renderMessageParagraphs(body) {
  return stripGeneratedGreeting(body)
    .split(/\n\s*\n|\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 14px">${escapeHtml(paragraph)}</p>`)
    .join('');
}

function formatReferencePrice(value, currency = 'CNY') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '--';
  return `${escapeHtml(currency || 'CNY')} ${amount.toFixed(2)}`;
}

function renderPriceBlock(pricedProducts = [], priceListDate = '') {
  if (!Array.isArray(pricedProducts) || !pricedProducts.length) return '';
  const currency = escapeHtml(pricedProducts[0]?.currency || 'CNY');
  const cards = pricedProducts.map((product) => `
                    <td width="50%" style="width:50%;padding:7px;vertical-align:top">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;height:104px;border:1px solid #dce6e8;border-collapse:collapse;background:#fff">
                        <tr>
                          <td width="92" style="width:92px;padding:7px;vertical-align:middle;background:#f4f7f7">
                            ${product.imageUrl
                              ? `<img src="${escapeHtml(product.imageUrl)}" width="78" height="76" alt="${escapeHtml(product.model)} ${escapeHtml(product.imageLabel || 'exact product image')}" style="display:block;width:78px;height:76px;object-fit:contain;border:0">`
                              : '<span style="display:block;color:#7c898e;font-size:10px;line-height:14px;text-align:center">Exact model image pending</span>'}
                          </td>
                          <td style="padding:8px 7px;vertical-align:middle">
                            <span style="display:block;color:#65747b;font-size:9px;line-height:13px;text-transform:uppercase">MEAN WELL</span>
                            <strong style="display:block;margin:2px 0 5px;color:#17384e;font-size:13px;line-height:17px">${escapeHtml(product.model)}</strong>
                            <span style="display:block;color:#17384e;font-size:11px;line-height:15px">${formatReferencePrice(product.price, product.currency)} / PC</span>
                            <span style="display:block;margin-top:2px;color:#118f42;font-size:10px;line-height:14px;font-weight:700">${escapeHtml(product.availability || 'In Stock')}</span>
                          </td>
                        </tr>
                      </table>
                    </td>`);
  const cardRows = [];
  for (let index = 0; index < cards.length; index += 2) {
    cardRows.push(`<tr>${cards.slice(index, index + 2).join('')}${cards[index + 1] ? '' : '<td width="50%" style="width:50%;padding:7px">&nbsp;</td>'}</tr>`);
  }
  const dateNote = priceListDate ? ` List updated ${escapeHtml(priceListDate)}.` : '';
  return `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;margin:24px 0 8px">
                <tr><td style="padding:0 0 8px;color:#17384e;font-size:16px;font-weight:700">Selected MEAN WELL models</td><td align="right" style="padding:0 0 8px;color:#687880;font-size:11px">${currency} / PC</td></tr>
                <tr><td colspan="2" style="padding:0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;font-size:12px;line-height:1.3">${cardRows.join('')}</table></td></tr>
                <tr><td colspan="2" style="padding:8px 0 0;color:#738088;font-size:11px;line-height:17px">Prices are for initial reference only.${dateNote} Final price depends on model, quantity, destination and commercial terms.</td></tr>
              </table>`;
}

function templateGreeting({ customer, contact }) {
  const name = outboundLabel(contact?.name);
  const company = outboundLabel(customer?.companyName);
  return name || company ? `Dear ${name || `${company} Team`},` : 'Dear Team,';
}

function marketContextLine(customer) {
  const company = outboundLabel(customer?.companyName, 'your company');
  const country = outboundLabel(customer?.countryEnglish || customer?.country);
  return country
    ? `A practical starting point for ${company} in ${country}.`
    : `A practical starting point for ${company}.`;
}

export function buildFirstTouchEmailText({ body, sales, customer = {}, contact = {}, pricedProducts = [], priceListDate = '' }) {
  const prices = pricedProducts.map((product) => (
    `${product.model}: ${formatReferencePrice(product.price, product.currency)} / PC (${product.availability || 'In Stock'})`
  ));
  return [
    templateGreeting({ customer, contact }),
    '',
    marketContextLine(customer),
    '',
    stripGeneratedGreeting(body),
    '',
    prices.length ? 'Selected MEAN WELL models:' : '',
    ...prices,
    prices.length && priceListDate ? `Price list updated ${priceListDate}.` : '',
    prices.length ? 'Contact us with your target models, quantity and destination for a more favorable distributor quotation.' : '',
    '',
    sales.teamName,
    `Email: ${sales.email}`,
    `Website: ${sales.website}`,
  ].filter((line, index, lines) => line || (index > 0 && lines[index - 1])).join('\n').trim();
}

/**
 * Production first-touch layout. The AI supplies only the personalized copy;
 * the surrounding structure stays consistent with the approved template preview.
 */
export function buildFirstTouchEmailHtml({ body, sales, customer = {}, contact = {}, pricedProducts = [], priceListDate = '' }) {
  const signature = buildEmailSignatureHtml(sales);
  const greeting = escapeHtml(templateGreeting({ customer, contact }));
  const marketContext = escapeHtml(marketContextLine(customer));
  const logoUrl = escapeHtml(normalizeWebsite(sales.logoUrl));
  const message = renderMessageParagraphs(body);
  const priceBlock = renderPriceBlock(pricedProducts, priceListDate);
  const referenceCurrency = escapeHtml(pricedProducts[0]?.currency || 'CNY');

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6f4;color:#252b2f;font-family:Calibri,Arial,sans-serif">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;background:#f3f6f4">
      <tr><td align="center" style="padding:20px 10px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="width:640px;max-width:100%;border-collapse:collapse;background:#fff">
          <tr>
            <td style="padding:17px 34px;background:#fff;border-bottom:1px solid #dbe6e1">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">
                <tr>
                  <td style="vertical-align:middle">${logoUrl ? `<img src="${logoUrl}" width="190" alt="MEAN WELL KULON" style="display:block;width:190px;max-width:100%;height:auto;border:0">` : '<strong style="font-size:28px;line-height:32px;color:#082f4c">MEAN WELL KULON</strong>'}</td>
                  <td align="right" style="vertical-align:middle;font-size:11px;line-height:16px;color:#557169">MEAN WELL POWER SUPPLY SOLUTIONS</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0;background:#082f49;color:#fff;border-bottom:5px solid #45a66f">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse">
                <tr>
                  <td style="padding:29px 24px 31px 34px;vertical-align:top">
                    <p style="margin:0 0 10px;font-size:11px;line-height:17px;color:#85d496;font-weight:800">DISTRIBUTOR PRICE BRIEF</p>
                    <p style="margin:0;font-size:27px;line-height:32px;font-weight:700;color:#fff">Selected MEAN WELL<br><span style="color:#72d48a">models for your market</span></p>
                    <p style="margin:14px 0 0;font-size:13px;line-height:20px;color:#d5e2e6">A practical price reference for industrial power supply sourcing and quotation planning.</p>
                  </td>
                  <td style="width:30%;padding:31px 24px;border-left:1px solid #31566a;vertical-align:top">
                    <p style="margin:0 0 4px;font-size:9px;line-height:13px;color:#9eb5bf;font-weight:700">REFERENCE CURRENCY</p>
                    <p style="margin:0 0 20px;font-size:15px;line-height:19px;color:#fff;font-weight:700">${referenceCurrency} / PC</p>
                    <p style="margin:0 0 4px;font-size:9px;line-height:13px;color:#9eb5bf;font-weight:700">AVAILABILITY</p>
                    <p style="margin:0;font-size:15px;line-height:19px;color:#fff;font-weight:700">In Stock</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 34px 10px;font-size:15px;line-height:1.6">
              <p style="margin:0 0 18px;font-size:17px;font-weight:700;color:#113d35">${greeting}</p>
              <p style="margin:0 0 18px;color:#586267">${marketContext}</p>
              ${message}
              ${priceBlock}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;margin:24px 0 20px;background:#f0f7f2">
                <tr>
                  <td width="33%" style="width:33%;padding:16px 10px;border-right:1px solid #d5e7dc"><strong style="display:block;color:#113d35;font-size:16px;line-height:20px">MEAN WELL</strong><span style="display:block;color:#66736d;font-size:11px;line-height:17px">product-focused support</span></td>
                  <td width="33%" style="width:33%;padding:16px 10px;border-right:1px solid #d5e7dc"><strong style="display:block;color:#113d35;font-size:20px;line-height:20px">3000+</strong><span style="display:block;color:#66736d;font-size:11px;line-height:17px">partners worldwide</span></td>
                  <td width="34%" style="width:34%;padding:16px 10px"><strong style="display:block;color:#113d35;font-size:16px;line-height:20px">1 team</strong><span style="display:block;color:#66736d;font-size:11px;line-height:17px">from enquiry to shipment</span></td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 22px;background:#fff;border-left:4px solid #45a66f">
                <tr><td style="padding:13px 16px 4px;font-size:15px;font-weight:700;color:#113d35">What you can expect</td></tr>
                <tr><td style="padding:0 16px 13px;font-size:12px;line-height:19px;color:#66736d">Clear model information &nbsp;·&nbsp; Responsive quotation support &nbsp;·&nbsp; Practical communication for international orders</td></tr>
              </table>
              <p style="margin:0 0 20px">Contact us with your target models, quantity and destination, and we will check whether a more favorable distributor quotation is available for you.</p>
              <p style="margin:0 0 24px"><a href="mailto:${escapeHtml(sales.email)}?subject=MEAN%20WELL%20distributor%20quotation" style="display:inline-block;padding:11px 18px;background:#45a66f;color:#fff;text-decoration:none;font-weight:700">Request a better quotation</a></p>
            </td>
          </tr>
          <tr><td style="padding:0 34px 28px">${signature}</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`.trim();
}

function secondTouchContext({ customer = {}, draft = {} } = {}) {
  const company = outboundLabel(customer.companyName, 'your company');
  const industry = outboundLabel(draft.industry || customer.industry);
  return industry
    ? `I wanted to share a shorter selection based on ${company}'s work in ${industry}.`
    : `I wanted to share a shorter selection of practical MEAN WELL options for ${company}.`;
}

function renderSecondTouchProducts(pricedProducts = []) {
  const cards = pricedProducts.slice(0, 4).map((product) => `
                    <td width="50%" style="width:50%;padding:6px;vertical-align:top">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border:1px solid #dbe4e1;border-collapse:collapse;background:#f8faf9">
                        <tr>
                          <td height="118" style="height:118px;padding:8px;text-align:center;background:#fff;border-bottom:1px solid #e2e8e6">
                            ${product.imageUrl
                              ? `<img src="${escapeHtml(product.imageUrl)}" width="210" height="100" alt="MEAN WELL ${escapeHtml(product.model)}" style="display:inline-block;width:210px;max-width:100%;height:100px;object-fit:contain;border:0">`
                              : '<span style="color:#7c898e;font-size:10px;line-height:14px">Exact model image pending</span>'}
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:10px 12px 12px">
                            <span style="display:block;color:#75847e;font-size:8px;line-height:13px;font-weight:700">MEAN WELL</span>
                            <strong style="display:block;margin-top:2px;color:#153e34;font-size:14px;line-height:19px">${escapeHtml(product.model)}</strong>
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin-top:8px;border-collapse:collapse">
                              <tr>
                                <td style="color:#1e4754;font-size:10px;line-height:15px;font-weight:700">${formatReferencePrice(product.price, product.currency)} / PC</td>
                                <td align="right" style="color:#16814b;font-size:9px;line-height:15px;font-weight:700;white-space:nowrap">${escapeHtml(product.availability || 'In Stock')}</td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>`);
  const rows = [];
  for (let index = 0; index < cards.length; index += 2) {
    rows.push(`<tr>${cards.slice(index, index + 2).join('')}${cards[index + 1] ? '' : '<td width="50%" style="width:50%;padding:6px">&nbsp;</td>'}</tr>`);
  }
  return rows.join('');
}

export function buildSecondTouchSubject({ customer = {} } = {}) {
  const company = outboundLabel(customer.companyName);
  return company
    ? `A short MEAN WELL shortlist for ${company}`
    : 'A short MEAN WELL shortlist for your projects';
}

export function buildSecondTouchEmailText({
  sales, customer = {}, contact = {}, draft = {}, pricedProducts = [], priceListDate = '',
}) {
  const prices = pricedProducts.slice(0, 4).map((product) => (
    `${product.model}: ${formatReferencePrice(product.price, product.currency)} / PC (${product.availability || 'In Stock'})`
  ));
  return [
    templateGreeting({ customer, contact }),
    '',
    secondTouchContext({ customer, draft }),
    '',
    'The models below cover practical power supply requirements for industrial equipment and control applications. All are currently marked In Stock; prices are initial USD references for planning.',
    '',
    ...prices,
    prices.length && priceListDate ? `Price list updated ${priceListDate}.` : '',
    '',
    'If you are sourcing one of these models, or need a different voltage or power rating, reply with the model numbers, quantity and destination. We will check availability and send a more favorable quotation.',
    '',
    'Best regards,',
    sales.teamName,
    `Email: ${sales.email}`,
    `Website: ${sales.website}`,
  ].filter((line, index, lines) => line || (index > 0 && lines[index - 1])).join('\n').trim();
}

/** Production follow-up for recipients who engaged with the first email. */
export function buildSecondTouchEmailHtml({
  sales, customer = {}, contact = {}, draft = {}, pricedProducts = [], priceListDate = '',
}) {
  const products = pricedProducts.slice(0, 4);
  const logoUrl = escapeHtml(normalizeWebsite(sales.logoUrl));
  const greeting = escapeHtml(templateGreeting({ customer, contact }));
  const context = escapeHtml(secondTouchContext({ customer, draft }));
  const industry = escapeHtml(outboundLabel(draft.industry || customer.industry, 'your business'));
  const currency = escapeHtml(products[0]?.currency || 'USD');
  const priceNote = priceListDate ? ` Price list updated ${escapeHtml(priceListDate)}.` : '';
  const website = escapeHtml(normalizeWebsite(sales.website));
  const websiteText = escapeHtml(websiteLabel(sales.website));
  const email = escapeHtml(sales.email);

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#edf1ef;color:#2e3c40;font-family:Arial,Helvetica,sans-serif">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;background:#edf1ef">
      <tr><td align="center" style="padding:24px 10px 34px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="width:640px;max-width:100%;border-collapse:collapse;background:#fff">
          <tr>
            <td style="padding:16px 34px;border-bottom:1px solid #dce6e2">
              ${logoUrl ? `<img src="${logoUrl}" width="190" alt="MEAN WELL KULON" style="display:block;width:190px;max-width:100%;height:auto;border:0">` : '<strong style="color:#153e34;font-size:24px;line-height:30px">MEAN WELL KULON</strong>'}
            </td>
          </tr>
          <tr>
            <td style="padding:28px 38px 29px;color:#fff;background:#103f32;border-bottom:4px solid #d6ad45">
              <p style="margin:0 0 9px;color:#f1d485;font-size:9px;line-height:14px;font-weight:800">${industry.toUpperCase()} &middot; SELECTED FOR YOUR BUSINESS</p>
              <p style="margin:0;color:#fff;font-size:29px;line-height:34px;font-weight:700">A shorter list.<br><span style="color:#9fd1ae">More relevant options.</span></p>
              <p style="margin:11px 0 0;color:#d4e4de;font-size:12px;line-height:18px">Four practical MEAN WELL models for industrial equipment and control applications.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:29px 38px 34px;color:#2e3c40;font-size:14px;line-height:22px">
              <p style="margin:0 0 15px;color:#153e34;font-size:16px;font-weight:700">${greeting}</p>
              <p style="margin:0 0 15px">${context}</p>
              <p style="margin:0 0 15px">The models below cover practical power supply requirements for industrial equipment and control applications. All are currently marked <strong>In Stock</strong>; prices are initial USD references for planning.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:19px 0 8px;border-collapse:collapse">
                ${renderSecondTouchProducts(products)}
              </table>
              <p style="margin:7px 6px 18px;color:#738079;font-size:10px;line-height:15px">Reference prices are shown in ${currency} per piece.${priceNote} Final pricing depends on model, quantity, destination and commercial terms.</p>
              <p style="margin:0 0 15px">If you are sourcing one of these models, or need a different voltage or power rating, reply with the model numbers, quantity and destination. We will check availability and send a more favorable quotation.</p>
              <p style="margin:22px 0 24px"><a href="mailto:${email}?subject=MEAN%20WELL%20model%20quotation" style="display:inline-block;padding:11px 17px;color:#fff;background:#18824b;font-size:12px;font-weight:700;text-decoration:none">Reply with models &amp; quantity</a></p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin-top:24px;border-collapse:collapse;border-top:1px solid #dce5e2">
                <tr>
                  <td style="padding-top:18px;color:#718078;font-size:10px;line-height:16px;vertical-align:bottom">
                    <span style="display:block">Best regards,</span>
                    <strong style="display:block;color:#153e34;font-size:11px">${escapeHtml(sales.teamName)}</strong>
                    <a href="mailto:${email}" style="display:block;color:#26758b;text-decoration:none">${email}</a>
                  </td>
                  <td align="right" style="padding-top:18px;color:#718078;font-size:10px;line-height:16px;vertical-align:bottom"><a href="${website}" style="color:#26758b;text-decoration:none">${websiteText}</a></td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`.trim();
}
