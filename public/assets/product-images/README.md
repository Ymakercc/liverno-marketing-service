# Exact model product images

This directory contains the optional local image cache. The current production
image files are hosted under `public_html/MarketResource/AllSeriesPicturesOfMEANWELL/`
on Hostinger, and `index.json` maps each concrete model image to its public URL.

Examples:

```text
LRS-350-24.jpg
HDR-60-24.jpg
ELG-150-24.png
GST60A12.jpg
```

The filename, without its extension, should be the complete model number when
using local files. Remote entries may point to a concrete base model image such
as `HLG-100H.png` for a priced variant such as `HLG-100-24`; a pure family image
such as `HLG.png` is never accepted as a fallback.

The optional `index.json` can map a model to a different filename or an
absolute public URL:

```json
{
  "models": {
    "LRS-350-24": "https://meanwell.business/MarketResource/.../LRS-350-24.jpg"
  }
}
```
