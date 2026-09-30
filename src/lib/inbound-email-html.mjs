import sanitizeHtml from 'sanitize-html';

const MAX_STORED_HTML_BYTES = 4_000_000;
const MAX_INLINE_IMAGE_BYTES = 800_000;
const MAX_INLINE_IMAGES_BYTES = 2_500_000;

const ALLOWED_TAGS = [
  'html', 'head', 'body',
  'div', 'span', 'p', 'br', 'hr', 'center', 'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col',
  'img', 'a', 'font', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'sub', 'sup',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
];

const ALLOWED_ATTRIBUTES = {
  '*': ['class', 'id', 'style', 'title', 'dir', 'lang', 'align', 'valign', 'width', 'height', 'bgcolor'],
  a: ['href', 'name', 'target', 'rel', 'class', 'id', 'style', 'title'],
  img: ['src', 'alt', 'width', 'height', 'border', 'class', 'id', 'style', 'title'],
  table: ['width', 'height', 'border', 'cellpadding', 'cellspacing', 'align', 'valign', 'bgcolor', 'class', 'id', 'style'],
  td: ['width', 'height', 'colspan', 'rowspan', 'align', 'valign', 'bgcolor', 'class', 'id', 'style'],
  th: ['width', 'height', 'colspan', 'rowspan', 'align', 'valign', 'bgcolor', 'class', 'id', 'style'],
  col: ['width', 'span', 'class', 'id', 'style'],
  font: ['color', 'face', 'size', 'class', 'id', 'style'],
};

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function contentId(value) {
  return clean(value).replace(/^<|>$/g, '');
}

function inlineCidImages(html, attachments = []) {
  let result = html;
  let totalBytes = 0;
  for (const attachment of attachments || []) {
    const id = contentId(attachment.contentId || attachment.cid);
    const mimeType = clean(attachment.contentType).toLowerCase();
    const content = Buffer.isBuffer(attachment.content) ? attachment.content : null;
    if (!id || !content || !mimeType.startsWith('image/')) continue;
    if (content.length > MAX_INLINE_IMAGE_BYTES || totalBytes + content.length > MAX_INLINE_IMAGES_BYTES) continue;
    const dataUrl = `data:${mimeType};base64,${content.toString('base64')}`;
    const candidates = [id, encodeURIComponent(id)];
    for (const candidate of candidates) {
      result = result.replace(new RegExp(`cid:${escapeRegExp(candidate)}`, 'gi'), dataUrl);
    }
    totalBytes += content.length;
  }
  return result;
}

function imageDimension(value) {
  const parsed = Number.parseFloat(clean(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isTrackingImage(attribs = {}) {
  const src = clean(attribs.src).toLowerCase();
  const style = clean(attribs.style).toLowerCase();
  const width = imageDimension(attribs.width);
  const height = imageDimension(attribs.height);
  if (width > 0 && width <= 2 && height > 0 && height <= 2) return true;
  if (/display\s*:\s*none|visibility\s*:\s*hidden/.test(style)) return true;
  if (/width\s*:\s*[012](?:px)?[^;]*;?.*height\s*:\s*[012](?:px)?/i.test(style)) return true;
  return /(?:sendib|brevo)[^/]*\/(?:tr|track)\/(?:op|open)(?:\/|\?|$)/i.test(src)
    || /\/(?:open|tracking)[-_]?(?:pixel|image)(?:[./?]|$)/i.test(src);
}

function disableLink(_tagName, attribs) {
  const { href: _href, target: _target, rel: _rel, ...safeAttributes } = attribs;
  return { tagName: 'a', attribs: safeAttributes };
}

export function prepareInboundEmailHtml(parsed = {}) {
  const rawHtml = typeof parsed.html === 'string' ? parsed.html.trim() : '';
  if (!rawHtml) return '';
  const withInlineImages = inlineCidImages(rawHtml, parsed.attachments);
  const safeHtml = sanitizeHtml(withInlineImages, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto', 'data', 'cid'],
    allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: { a: disableLink },
    exclusiveFilter: (frame) => frame.tag === 'img' && isTrackingImage(frame.attribs),
  });
  return Buffer.byteLength(safeHtml, 'utf8') <= MAX_STORED_HTML_BYTES ? safeHtml : '';
}

export function buildInboundEmailDocument(html) {
  const previewStyle = `<style id="kulon-inbox-preview-style">
    html { color-scheme: light; background: #fff; }
    body { margin: 0; padding: 20px; color: #17231f; background: #fff; font-family: Arial, Helvetica, sans-serif; overflow-wrap: anywhere; }
    img { max-width: 100% !important; height: auto; }
    table { max-width: 100%; }
    a { cursor: default; }
  </style>`;
  const meta = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return `<!doctype html>${html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}${previewStyle}`)}`;
  }
  if (/<html(?:\s[^>]*)?>/i.test(html)) {
    return `<!doctype html>${html.replace(/<html(?:\s[^>]*)?>/i, (root) => `${root}<head>${meta}${previewStyle}</head>`)}`;
  }
  return `<!doctype html><html><head>${meta}${previewStyle}</head><body>${html}</body></html>`;
}
