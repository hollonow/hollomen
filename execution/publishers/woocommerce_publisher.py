#!/usr/bin/env python3
"""
AGENT 5: WooCommerce Publisher
Bridges the HolloEngine Master Sheet → WooCommerce product drafts.

Safety Rules (hardcoded, never change):
  - Status always DRAFT — client must manually publish
  - Price fields always EMPTY — client sets pricing
  - Jetpack Publicize disabled — no accidental social leaks

Workflow:
  1. Download categorized WebP images from Cloudinary
  2. Upload to WordPress Media Library (with alt text)
  3. Create variable product draft with size variations
  4. Map all SEO columns to Rank Math meta fields
  5. Inject JSON-LD schema via meta fields
"""

import json
import logging
import os
import re
from typing import Dict, List, Optional, Tuple

import cloudinary
import cloudinary.api
import requests
from requests.auth import HTTPBasicAuth
from woocommerce import API

logger = logging.getLogger(__name__)

# Viewpoint priority — determines featured image selection and gallery order.
# Front-view is always preferred as the hero/featured image.
VIEWPOINT_PRIORITY = ['front', 'side', 'back', 'sole', 'overhead', 'inside', 'on-feet', 'on_feet', 'detail']


class PublishResult:
    """Result of a single product publish operation."""

    def __init__(self):
        self.success: bool = False
        self.wc_product_id: Optional[int] = None
        self.wc_product_url: Optional[str] = None
        self.wc_draft_edit_url: Optional[str] = None
        self.images_uploaded: int = 0
        self.variations_created: int = 0
        self.error: Optional[str] = None


CLOUDINARY_CDN = 'https://res.cloudinary.com'


class WooCommercePublisher:
    """
    Publishes HolloEngine products to WooCommerce as variable product drafts.
    Integrates with WordPress Media Library and Rank Math SEO.
    """

    def __init__(
        self,
        wc_url: str,
        consumer_key: str,
        consumer_secret: str,
        wp_username: str,
        wp_app_password: str,
        cloudinary_cloud_name: str,
        timeout: int = 60,
    ):
        self.wc_url = wc_url.rstrip('/')
        self.wp_auth = HTTPBasicAuth(wp_username, wp_app_password)
        self.cloud_name = cloudinary_cloud_name
        self.timeout = timeout

        self.wcapi = API(
            url=self.wc_url,
            consumer_key=consumer_key,
            consumer_secret=consumer_secret,
            version='wc/v3',
            timeout=timeout,
        )
        logger.info(f'WooCommercePublisher ready: {self.wc_url}')

    # ─────────────────────────────────────────────
    # CLOUDINARY HELPERS
    # ─────────────────────────────────────────────

    def _list_cloudinary_webp(self, product_id: str) -> List[Dict]:
        """Return all WebP resources in hollomen/{product_id}/, sorted by public_id."""
        prefix = f'hollomen/{product_id}/'
        results = []
        next_cursor = None
        while True:
            kwargs = {'prefix': prefix, 'resource_type': 'image', 'max_results': 100, 'type': 'upload'}
            if next_cursor:
                kwargs['next_cursor'] = next_cursor
            response = cloudinary.api.resources(**kwargs)
            resources = response.get('resources', [])
            # Keep only WebP files (Agent 4 output)
            results.extend(r for r in resources if r.get('format') == 'webp')
            next_cursor = response.get('next_cursor')
            if not next_cursor:
                break
        return sorted(results, key=lambda r: r['public_id'])

    def _download_cloudinary(self, public_id: str) -> bytes:
        """Download a Cloudinary WebP by public_id and return raw bytes."""
        url = f'{CLOUDINARY_CDN}/{self.cloud_name}/image/upload/{public_id}.webp'
        resp = requests.get(url, timeout=self.timeout)
        resp.raise_for_status()
        return resp.content

    # ─────────────────────────────────────────────
    # VIEWPOINT DETECTION
    # ─────────────────────────────────────────────

    def _get_viewpoint_rank(self, filename: str) -> int:
        """
        Return the priority rank of a viewpoint from its filename.
        Lower number = higher priority (front=0 is best for hero image).
        Returns len(VIEWPOINT_PRIORITY) if no viewpoint found (lowest priority).
        """
        name_lower = filename.lower().replace('-', '').replace('_', '')
        for i, vp in enumerate(VIEWPOINT_PRIORITY):
            vp_clean = vp.replace('-', '').replace('_', '')
            if vp_clean in name_lower:
                return i
        return len(VIEWPOINT_PRIORITY)

    # ─────────────────────────────────────────────
    # WORDPRESS MEDIA LIBRARY
    # ─────────────────────────────────────────────

    def _upload_to_wp_media(self, file_bytes: bytes, filename: str, alt_text: str) -> Optional[int]:
        """
        Upload image bytes to WordPress Media Library.
        Returns WordPress media ID on success, None on failure.
        """
        url = f'{self.wc_url}/wp-json/wp/v2/media'
        try:
            resp = requests.post(
                url,
                auth=self.wp_auth,
                headers={
                    'Content-Disposition': f'attachment; filename="{filename}"',
                    'Content-Type': 'image/webp',
                },
                data=file_bytes,
                timeout=self.timeout,
            )
            resp.raise_for_status()
            media_id = resp.json()['id']

            # Set alt text in a follow-up PATCH
            requests.post(
                f'{self.wc_url}/wp-json/wp/v2/media/{media_id}',
                auth=self.wp_auth,
                json={'alt_text': alt_text},
                timeout=30,
            )
            logger.info(f'    ↑ {filename} → WP media #{media_id}')
            return media_id

        except Exception as e:
            logger.error(f'    ✗ Upload failed for {filename}: {e}')
            return None

    def upload_product_images(
        self, product_id: str, cms_title: str
    ) -> Tuple[Optional[int], List[int]]:
        """
        Download all WebP images from Cloudinary → upload to WP Media Library.
        Returns (featured_image_id, gallery_image_ids).

        FIX: Images are now sorted by VIEWPOINT_PRIORITY before uploading.
        The highest-priority viewpoint (front-view) is always set as the featured/hero image.
        This prevents sole-view or back-view from accidentally becoming the product thumbnail.
        """
        resources = self._list_cloudinary_webp(product_id)
        if not resources:
            logger.warning(f'No WebP files in Cloudinary for product {product_id}')
            return None, []

        # ── FIX 2: Sort by viewpoint priority before uploading ──────────────
        # This ensures front-view is always first regardless of alphabetical order.
        # Without this sort, alphabetical ordering could place back-view or detail-view
        # before front-view, making them candidates for the featured image slot.
        def sort_key(r):
            filename = r['public_id'].split('/')[-1]
            return self._get_viewpoint_rank(filename)

        resources_sorted = sorted(resources, key=sort_key)
        logger.info(f'Uploading {len(resources_sorted)} images to WordPress Media Library...')
        logger.info(f'  Upload order: {[r["public_id"].split("/")[-1] for r in resources_sorted]}')

        featured_id: Optional[int] = None
        gallery_ids: List[int] = []

        for r in resources_sorted:
            public_id = r['public_id']
            filename = public_id.split('/')[-1] + '.webp'
            name_lower = filename.lower()

            # Derive viewpoint label for alt text
            viewpoint_label = 'View'
            for vp in VIEWPOINT_PRIORITY:
                if vp.replace('-', '').replace('_', '') in name_lower.replace('-', '').replace('_', ''):
                    viewpoint_label = vp.replace('-', ' ').replace('_', ' ').title()
                    break

            alt_text = f'{cms_title} — {viewpoint_label}'

            try:
                file_bytes = self._download_cloudinary(public_id)
                media_id = self._upload_to_wp_media(file_bytes, filename, alt_text)
                if media_id is None:
                    continue

                # First image uploaded is always the best viewpoint (front-view if exists)
                if featured_id is None:
                    featured_id = media_id
                    logger.info(f'    → Featured image: {filename} (viewpoint rank={self._get_viewpoint_rank(filename)})')
                else:
                    gallery_ids.append(media_id)

            except Exception as e:
                logger.error(f'    Error processing {public_id}: {e}')

        logger.info(f'Images ready: 1 featured + {len(gallery_ids)} gallery')
        return featured_id, gallery_ids

    # ─────────────────────────────────────────────
    # SIZE PARSING
    # ─────────────────────────────────────────────

    def parse_sizes(self, english_translation: str, raw_chinese: str) -> List[str]:
        """
        Extract EU shoe sizes (35–47) from supplier text.

        FIX: Three improvements over the original:

        1. Handles ranges adjacent to Chinese characters (e.g. 码：38-44 or 码38-44).
           The original \b word boundary failed when Chinese chars were directly adjacent
           to numbers — Chinese chars are non-word chars so \b was unreliable.

        2. Strips parenthetical custom-order notes (e.g. (45订做不退换)) BEFORE parsing
           so custom/special sizes don't get included in the standard size list.

        3. Prioritises range format over explicit list when both are present, because
           supplier text like "码：38-44" is an unambiguous size range declaration,
           whereas scattered numbers in the full translation (prices, model numbers)
           can produce false positives in the explicit regex.
        """
        text = f'{english_translation or ""} {raw_chinese or ""}'

        # ── Step 1: Strip parenthetical custom-order annotations ────────────
        # e.g. "(45订做不退换)" = "size 45 is custom order, no returns"
        # These sizes should NOT appear as available options in the dropdown.
        text_clean = re.sub(r'\([^)]*[\u4e00-\u9fff][^)]*\)', '', text)

        # ── Step 2: Try range first (most reliable for supplier text) ────────
        # Handles: 38-44, 38–44, 38 - 44, 码：38-44, 码38-44
        # Using (?<!\d) and (?!\d) instead of \b to handle adjacent Chinese chars
        range_match = re.search(
            r'(?<!\d)(3[5-9]|4[0-7])\s*[-–]\s*(3[5-9]|4[0-7])(?!\d)',
            text_clean
        )
        if range_match:
            start, end = int(range_match.group(1)), int(range_match.group(2))
            if start <= end:
                sizes = [str(s) for s in range(start, end + 1)]
                logger.info(f'Sizes parsed (range {start}-{end}): {sizes}')
                return sizes

        # ── Step 3: Fall back to explicit list ────────────────────────────
        # Only used when no range is found. Looks for standalone EU sizes (35-47).
        # Using (?<!\d) and (?!\d) to avoid matching digits inside larger numbers
        # (e.g. price "180" should not match as "18" + "0").
        explicit = re.findall(r'(?<!\d)(3[5-9]|4[0-7])(?!\d)', text_clean)
        if explicit:
            sizes = sorted(set(explicit), key=int)
            logger.info(f'Sizes parsed (explicit): {sizes}')
            return sizes

        logger.warning('No EU sizes found in supplier text — product will be SIMPLE type')
        return []

    def _parse_color(self, product_name: str) -> Optional[str]:
        """
        Extract color from product name.
        PATH B format: "Heritage Boot - Cognac Brown" → "Cognac Brown"
        PATH A format: "Gucci Horsebit Men's Black Leather Loafer" → "Black"
        """
        if not product_name:
            return None

        # PATH B: color after " - " separator
        dash_match = re.search(r'\s-\s(.+)$', product_name.strip())
        if dash_match:
            return dash_match.group(1).strip()

        # PATH A: scan for known color words
        color_words = (
            'Black', 'White', 'Brown', 'Cognac', 'Grey', 'Gray', 'Navy', 'Blue', 'Red',
            'Green', 'Tan', 'Beige', 'Cream', 'Burgundy', 'Camel', 'Gold', 'Silver',
            'Khaki', 'Olive', 'Orange', 'Purple', 'Pink', 'Yellow', 'Midnight', 'Espresso',
            'Chocolate', 'Ivory', 'Sand', 'Stone', 'Taupe', 'Rust', 'Charcoal', 'Bone',
        )
        name_lower = product_name.lower()
        for color in color_words:
            if color.lower() in name_lower:
                return color

        return None

    def _parse_tags_from_notes(self, notes: str) -> List[Dict]:
        """
        Parse WooCommerce tags from the Notes field.
        Expects 'Keywords: k1, k2, k3' format written by Agent 3.
        Returns list of WC tag objects e.g. [{"name": "luxury sneaker"}].
        """
        if not notes:
            return []
        match = re.search(r'Keywords:\s*(.+)', notes)
        if not match:
            return []
        raw = match.group(1).strip()
        return [{'name': kw.strip()} for kw in raw.split(',') if kw.strip()]

    def _get_categories(self, designer_brand: str) -> List[Dict]:
        """
        Map designer_brand to WooCommerce category IDs.
        Configure via WC_BRAND_CATEGORY_MAP env var (JSON object: brand → category_id).
        Example: {"Fendi": 5, "Balenciaga": 8, "Prada": 12, "Gucci": 14}
        Falls back to WC_DEFAULT_CATEGORY_ID if no brand match found.
        Uses fuzzy matching — "Louis Vuitton" matches a key "Louis Vuitton Clothing".
        """
        raw_map = os.getenv('WC_BRAND_CATEGORY_MAP', '{}')
        default_id = os.getenv('WC_DEFAULT_CATEGORY_ID')
        try:
            brand_map: Dict[str, int] = json.loads(raw_map)
        except json.JSONDecodeError:
            logger.warning('WC_BRAND_CATEGORY_MAP is not valid JSON — skipping categories')
            return [{'id': int(default_id)}] if default_id else []

        # Exact match first
        if designer_brand in brand_map:
            return [{'id': brand_map[designer_brand]}]

        # Fuzzy match: check if brand name appears inside a map key or vice versa
        brand_lower = designer_brand.lower()
        for key, cat_id in brand_map.items():
            if brand_lower in key.lower() or key.lower() in brand_lower:
                logger.info(f'Category fuzzy match: "{designer_brand}" → "{key}" (id={cat_id})')
                return [{'id': cat_id}]

        # Fallback to default category
        if default_id:
            logger.warning(f'No category match for brand "{designer_brand}" — using WC_DEFAULT_CATEGORY_ID={default_id}')
            return [{'id': int(default_id)}]

        logger.warning(f'No category match for brand "{designer_brand}" and WC_DEFAULT_CATEGORY_ID not set')
        return []

    # ─────────────────────────────────────────────
    # WOOCOMMERCE PRODUCT CREATION
    # ─────────────────────────────────────────────

    def _build_meta_data(self, row: Dict) -> List[Dict]:
        """
        Build WooCommerce meta_data array.
        Maps HolloEngine sheet columns → Rank Math + WordPress meta keys.
        """
        meta = []

        # ── Rank Math SEO ──────────────────────────────
        if row.get('cms_title'):
            meta.append({'key': 'rank_math_title',          'value': row['cms_title']})
            meta.append({'key': 'rank_math_og_title',       'value': row['cms_title']})
        if row.get('meta_description'):
            meta.append({'key': 'rank_math_description',    'value': row['meta_description']})
            meta.append({'key': 'rank_math_og_description', 'value': row['meta_description']})
        if row.get('final_product_name'):
            meta.append({'key': 'rank_math_focus_keyword',  'value': row['final_product_name']})

        # ── JSON-LD Schema ─────────────────────────────
        # NOTE: rank_math_schema_Product is NOT a valid REST API meta key — Rank Math
        # auto-generates Product schema from WooCommerce data. Do not attempt to set it.
        if row.get('faq_json_ld'):
            meta.append({'key': 'holloengine_faq_schema',   'value': row['faq_json_ld']})

        # ── Safety: Disable Jetpack Publicize ──────────
        # Prevents accidental social media posts from WooCommerce drafts
        meta.append({'key': '_wpas_skip_all_connections',         'value': '1'})
        meta.append({'key': '_jetpack_dont_email_post_to_subs',   'value': '1'})
        meta.append({'key': 'wpas_skip',                          'value': '1'})

        # ── HolloEngine audit trail ────────────────────
        if row.get('product_id'):
            meta.append({'key': 'holloengine_product_id', 'value': row['product_id']})

        return meta

    def create_wc_product(
        self,
        row: Dict,
        featured_id: Optional[int],
        gallery_ids: List[int],
        sizes: List[str],
    ) -> Optional[Dict]:
        """
        Create a WooCommerce variable (or simple) product draft.
        PRICE IS INTENTIONALLY LEFT EMPTY — client sets pricing before publishing.
        STATUS IS HARDCODED TO DRAFT — never published automatically.
        """
        # Build image array: featured image first, then gallery
        images = []
        if featured_id:
            images.append({'id': featured_id, 'alt': row.get('cms_title', '')})
        for gid in gallery_ids:
            images.append({'id': gid, 'alt': row.get('cms_title', '')})

        product_type = 'variable' if sizes else 'simple'

        # ── Derived fields ─────────────────────────────
        brand       = row.get('designer_brand', '')
        color       = self._parse_color(row.get('final_product_name', ''))
        material    = (row.get('material_info') or '').split('\n')[0].strip()[:50]
        tags        = self._parse_tags_from_notes(row.get('notes', ''))
        categories  = self._get_categories(brand)

        payload = {
            'name':              row.get('cms_title') or row.get('final_product_name', ''),
            'type':              product_type,
            'status':            'draft',          # SAFETY: always draft
            'stock_status':      'instock',        # Show as available; client sets price before publish
            'manage_stock':      False,             # No inventory tracking — client manages
            'description':       row.get('cms_body_html', ''),
            'short_description': row.get('product_description') or '',
            'slug':              row.get('seo_slug', ''),
            'sku':               f"HE-{row.get('product_id', '')}",
            'images':            images,
            'meta_data':         self._build_meta_data(row),
            # SAFETY: prices intentionally omitted — client must set before publishing
        }

        if categories:
            payload['categories'] = categories

        if tags:
            payload['tags'] = tags

        # Build attributes: Size (variation) first, then Brand + Color + Material (display only)
        # Size must be position=0 and variation=True to appear as a dropdown on the product page.
        attributes = []
        if sizes:
            attributes.append({
                'name':      'Size',
                'position':  0,
                'visible':   True,
                'variation': True,
                'options':   sizes,
            })
        if brand:
            attributes.append({
                'name':      'Brand',
                'position':  1,
                'visible':   True,
                'variation': False,
                'options':   [brand],
            })
        if color:
            attributes.append({
                'name':      'Color',
                'position':  2,
                'visible':   True,
                'variation': False,
                'options':   [color],
            })
        if material:
            attributes.append({
                'name':      'Material',
                'position':  3,
                'visible':   True,
                'variation': False,
                'options':   [material],
            })

        if attributes:
            payload['attributes'] = attributes

        logger.info(
            f'  Brand={brand or "—"} | Color={color or "—"} | '
            f'Material={material or "—"} | Tags={len(tags)} | '
            f'Categories={len(categories)} | SKU=HE-{row.get("product_id","")}'
        )

        # Log size summary for verification
        if sizes:
            logger.info(f'  Sizes ({len(sizes)}): {" | ".join(sizes)}')
        else:
            logger.warning('  No sizes found — creating SIMPLE product (no size dropdown)')

        try:
            resp = self.wcapi.post('products', payload)
            if resp.status_code not in (200, 201):
                logger.error(f'WC product creation failed {resp.status_code}: {resp.text[:400]}')
                return None
            product = resp.json()
            logger.info(f'✅ WC product #{product["id"]} created: {product.get("name")}')
            return product
        except Exception as e:
            logger.error(f'Error creating WC product: {e}')
            return None

    def create_size_variations(self, product_id: int, sizes: List[str]) -> int:
        """
        Create one variation per size.
        Prices left empty — client sets them before publishing.
        """
        created = 0
        for size in sizes:
            try:
                resp = self.wcapi.post(f'products/{product_id}/variations', {
                    'attributes':    [{'name': 'Size', 'option': size}],
                    'status':        'publish',
                    'regular_price': '',       # Client fills in
                    'stock_status':  'instock',
                })
                if resp.status_code in (200, 201):
                    created += 1
                else:
                    logger.warning(f'Variation {size} failed: {resp.status_code}')
            except Exception as e:
                logger.warning(f'Variation {size} error: {e}')

        logger.info(f'Size variations created: {created}/{len(sizes)}')
        return created

    # ─────────────────────────────────────────────
    # CONNECTIVITY TEST
    # ─────────────────────────────────────────────

    def test_connectivity(self) -> bool:
        """
        Ping WooCommerce REST API, WordPress REST API, and Cloudinary to verify credentials.
        Returns True only if all three respond successfully.
        """
        ok = True

        # WooCommerce REST API
        try:
            resp = self.wcapi.get('system_status')
            if resp.status_code == 200:
                logger.info(f'[OK] WooCommerce REST API ({self.wc_url})')
            else:
                logger.error(f'[FAIL] WooCommerce REST API returned {resp.status_code}: {resp.text[:200]}')
                ok = False
        except Exception as e:
            logger.error(f'[FAIL] WooCommerce REST API error: {e}')
            ok = False

        # WordPress REST API (same auth used for media uploads)
        try:
            resp = requests.get(
                f'{self.wc_url}/wp-json/wp/v2/media',
                auth=self.wp_auth,
                timeout=self.timeout,
            )
            if resp.status_code in (200, 201):
                logger.info('[OK] WordPress REST API (media endpoint auth verified)')
            elif resp.status_code == 401:
                logger.error(f'[FAIL] WordPress REST API 401 Unauthorized — check WP_USERNAME / WP_APP_PASSWORD')
                ok = False
            elif resp.status_code == 403:
                logger.error(f'[FAIL] WordPress REST API 403 Forbidden — /wp-json/wp/v2/ is still blocked by firewall/security plugin.')
                ok = False
            else:
                logger.error(f'[FAIL] WordPress REST API returned {resp.status_code}: {resp.text[:300]}')
                ok = False
        except Exception as e:
            logger.error(f'[FAIL] WordPress REST API error: {e}')
            ok = False

        # Cloudinary
        try:
            cloudinary.api.resources(prefix='hollomen/', max_results=1, resource_type='image', type='upload')
            logger.info(f'[OK] Cloudinary API (cloud: {self.cloud_name})')
        except Exception as e:
            logger.error(f'[FAIL] Cloudinary API error: {e}')
            ok = False

        return ok

    # ─────────────────────────────────────────────
    # MAIN ENTRY POINT
    # ─────────────────────────────────────────────

    def process_product(self, row: Dict) -> PublishResult:
        """
        Full publish pipeline for one product row.
          1. Upload Cloudinary images → WP Media Library (sorted by viewpoint priority)
          2. Parse size variations from supplier text
          3. Create WC variable product draft
          4. Create size variations (no prices)
        """
        result = PublishResult()
        product_id = row.get('product_id', 'UNKNOWN')
        cms_title = row.get('cms_title') or row.get('final_product_name', product_id)

        logger.info(f'{"=" * 60}')
        logger.info(f'Publishing {product_id}: {cms_title}')
        logger.info(f'{"=" * 60}')

        # ── Step 1: Media ──────────────────────────────
        featured_id, gallery_ids = self.upload_product_images(product_id, cms_title)
        result.images_uploaded = (1 if featured_id else 0) + len(gallery_ids)

        if result.images_uploaded == 0:
            logger.warning(f'No images found in Cloudinary for {product_id} — uploading without images')

        # ── Step 2: Sizes ──────────────────────────────
        sizes = self.parse_sizes(
            row.get('english_full_translation', ''),
            row.get('raw_chinese', ''),
        )

        # ── Step 3: Create product ─────────────────────
        wc_product = self.create_wc_product(row, featured_id, gallery_ids, sizes)
        if not wc_product:
            result.error = 'WooCommerce product creation failed — check API credentials and store URL'
            return result

        result.wc_product_id = wc_product['id']
        result.wc_product_url = wc_product.get('permalink', '')
        result.wc_draft_edit_url = f"{self.wc_url}/wp-admin/post.php?post={wc_product['id']}&action=edit"

        # ── Step 4: Size variations ────────────────────
        if sizes:
            result.variations_created = self.create_size_variations(wc_product['id'], sizes)

        result.success = True
        logger.info(
            f'✅ {product_id} → WC #{wc_product["id"]} '
            f'({result.images_uploaded} imgs, {result.variations_created} sizes)'
        )
        return result
