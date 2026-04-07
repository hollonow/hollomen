#!/usr/bin/env python3
"""
YUPOO MINER: Specialized scraper for Yupoo supplier sites.
Handles password protection, lazy loading, and Yupoo-specific HTML structure.
"""

import json
import logging
import re
import time
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

from .base_miner import BaseMiner, ProductData

logger = logging.getLogger(__name__)


class YupooMiner(BaseMiner):
    """Scraper for Yupoo product pages."""

    # Common luxury brand names to detect (used for brand hint extraction)
    KNOWN_BRANDS = [
        'GUCCI', 'PRADA', 'LOUIS VUITTON', 'LV', 'CHANEL', 'HERMES', 'HERMÈS',
        'DIOR', 'BALENCIAGA', 'GIVENCHY', 'VERSACE', 'FENDI', 'BURBERRY',
        'SAINT LAURENT', 'YSL', 'BOTTEGA VENETA', 'VALENTINO', 'CELINE',
        'CÉLINE', 'LOEWE', 'ALEXANDER MCQUEEN', 'OFF-WHITE', 'AMIRI',
        'PINKO', 'ZEGNA', 'ERMENEGILDO ZEGNA', "TOD'S", 'TODS', 'FERRAGAMO',
        'SALVATORE FERRAGAMO', 'JIMMY CHOO', 'CHRISTIAN LOUBOUTIN', 'LOUBOUTIN',
        'MONCLER', 'STONE ISLAND', 'RICK OWENS', 'MAISON MARGIELA', 'MARGIELA',
        'BALMAIN', 'DOLCE & GABBANA', 'D&G', 'ARMANI', 'EMPORIO ARMANI',
        'GIORGIO ARMANI', 'HUGO BOSS', 'BOSS', 'RALPH LAUREN', 'POLO',
        'THOM BROWNE', 'GOLDEN GOOSE', 'GGDB', 'COMMON PROJECTS', 'NIKE',
        'ADIDAS', 'NEW BALANCE', 'JORDAN', 'CONVERSE', 'VANS'
    ]

    def __init__(
        self,
        openai_api_key: str,
        cloudinary_cloud_name: str = None,
        cloudinary_api_key: str = None,
        cloudinary_api_secret: str = None,
        password: str = ""
    ):
        """Initialize Yupoo miner with Cloudinary storage and optional password."""
        super().__init__(
            openai_api_key=openai_api_key,
            cloudinary_cloud_name=cloudinary_cloud_name,
            cloudinary_api_key=cloudinary_api_key,
            cloudinary_api_secret=cloudinary_api_secret
        )
        self.default_password = password or self._load_default_password()

    def _load_default_password(self) -> str:
        """Load default Yupoo password from config file."""
        config_path = Path('config/yupoo_creds.json')
        if config_path.exists():
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    return data.get('default_password', '')
            except Exception as e:
                logger.warning(f"Failed to load yupoo_creds.json: {e}")
        return ""

    def extract_brand_hint(self, raw_text: str) -> Optional[str]:
        """
        Extract brand name from raw Chinese text using bracket patterns.

        Patterns checked (in priority order):
        1. 【BRAND】 (Chinese fullwidth brackets - most common in Yupoo listings)
        2. [BRAND] (Square brackets)
        3. Known brand names mentioned anywhere in text

        Returns:
            Brand name if found, None otherwise
        """
        if not raw_text:
            return None

        # Pattern 1: Chinese fullwidth brackets 【...】
        fullwidth_match = re.search(r'【([^】]+)】', raw_text)
        if fullwidth_match:
            brand = fullwidth_match.group(1).strip().upper()
            if self._validate_brand(brand):
                logger.info(f"[BRAND EXTRACTION] Found brand in 【】: {brand}")
                return brand

        # Pattern 2: Square brackets [...]
        square_match = re.search(r'\[([^\]]+)\]', raw_text)
        if square_match:
            brand = square_match.group(1).strip().upper()
            if self._validate_brand(brand):
                logger.info(f"[BRAND EXTRACTION] Found brand in []: {brand}")
                return brand

        # Pattern 3: Check for known brand names in text (case-insensitive)
        text_upper = raw_text.upper()
        for known_brand in self.KNOWN_BRANDS:
            if known_brand in text_upper:
                logger.info(f"[BRAND EXTRACTION] Found known brand in text: {known_brand}")
                return known_brand

        logger.info("[BRAND EXTRACTION] No brand hint found in raw text")
        return None

    def _is_size_pattern(self, text: str) -> bool:
        """
        Check if text looks like a size pattern rather than a brand.

        Size patterns:
        - Pure numbers with separators: "38-44", "35 36 37", "38/39/40"
        - Size keywords: "码", "SIZE", "EU", "US", "UK"
        - Number ranges: "38-44码", "SIZE 38-44"
        """
        text_upper = text.upper().strip()

        # Size keywords
        size_keywords = ['码', 'SIZE', 'EU ', 'US ', 'UK ', 'CM', 'MM']
        for keyword in size_keywords:
            if keyword in text_upper:
                return True

        # Pattern: mostly numbers with separators (38-44, 35/36/37, 38 39 40)
        # Remove common separators and check if remaining is mostly digits
        cleaned = re.sub(r'[-/\s,.]', '', text)
        if cleaned.isdigit() and len(cleaned) >= 2:
            return True

        # Pattern: number-number (38-44)
        if re.match(r'^\d+[-/]\d+$', text.strip()):
            return True

        return False

    def _validate_brand(self, brand: str) -> bool:
        """
        Validate if extracted text looks like a brand name.

        Accepts:
        - Known brands from our list
        - Text that is mostly letters (not prices, sizes, etc.)
        - Reasonable length (2-30 characters)

        Rejects:
        - Size patterns (38-44, SIZE 38, etc.)
        - Pure numbers or prices
        """
        if not brand or len(brand) < 2 or len(brand) > 30:
            return False

        # Reject size patterns first
        if self._is_size_pattern(brand):
            logger.debug(f"[BRAND VALIDATION] Rejected as size pattern: {brand}")
            return False

        # Check against known brands
        brand_upper = brand.upper()
        for known in self.KNOWN_BRANDS:
            if known in brand_upper or brand_upper in known:
                return True

        # Accept if mostly alphabetic (filters out "249" or "38-44")
        alpha_count = sum(1 for c in brand if c.isalpha())
        if len(brand) > 0 and alpha_count / len(brand) >= 0.6:
            return True

        return False

    def extract_supplier_id(self, url: str) -> str:
        """
        Extract album ID from Yupoo URL.
        Example: https://example.x.yupoo.com/albums/123456 -> 123456
        """
        # Pattern 1: /albums/123456
        match = re.search(r'/albums?/(\d+)', url)
        if match:
            return match.group(1)

        # Pattern 2: Check query params
        match = re.search(r'albumId=(\d+)', url)
        if match:
            return match.group(1)

        # Fallback: use last segment of path
        parsed = urlparse(url)
        segments = [s for s in parsed.path.split('/') if s]
        if segments:
            return segments[-1]

        raise ValueError(f"Could not extract supplier ID from URL: {url}")

    def handle_password_prompt(self, page) -> bool:
        """
        Detect and handle Yupoo password prompt if present.
        Returns True if password was entered, False if no prompt found.
        """
        try:
            # Check for password input field
            password_input = page.locator('input.showalbum__input').first
            if password_input.is_visible(timeout=2000):
                logger.info("Password prompt detected - entering password...")

                if not self.default_password:
                    raise Exception("Password required but no password configured in yupoo_creds.json")

                # Enter password
                password_input.fill(self.default_password)

                # Click submit button
                submit_button = page.locator('button:has-text("确定"), button:has-text("Submit")').first
                if submit_button.is_visible(timeout=1000):
                    submit_button.click()
                    page.wait_for_load_state('networkidle')
                    logger.info("Password submitted successfully")
                    return True

        except PlaywrightTimeoutError:
            # No password prompt found - this is fine
            pass
        except Exception as e:
            logger.warning(f"Error handling password prompt: {e}")

        return False

    def extract_images(self, page) -> List[str]:
        """
        Extract all product image URLs from Yupoo page.
        Converts thumbnail URLs to high-resolution versions.
        """
        logger.info("Extracting image URLs...")

        # Scroll to load all images
        self.scroll_to_bottom(page, delay_ms=800)

        # Extract image URLs from multiple possible selectors
        image_urls = []

        # Strategy 1: .showalbum__children img tags
        images = page.locator('.showalbum__children img').all()
        for img in images:
            src = img.get_attribute('src')
            if src:
                # Convert to high-res URL
                high_res_url = self._convert_to_highres(src)
                if high_res_url not in image_urls:
                    image_urls.append(high_res_url)

        # Strategy 2: Look for data-src attributes (lazy loading)
        if not image_urls:
            images = page.locator('img[data-src]').all()
            for img in images:
                src = img.get_attribute('data-src')
                if src:
                    high_res_url = self._convert_to_highres(src)
                    if high_res_url not in image_urls:
                        image_urls.append(high_res_url)

        # Strategy 3: Any img tag on the page (fallback)
        if not image_urls:
            logger.warning("Primary selectors failed - using fallback strategy")
            images = page.locator('img').all()
            for img in images:
                src = img.get_attribute('src') or img.get_attribute('data-src')
                if src and ('yupoo' in src or 'jpg' in src):
                    high_res_url = self._convert_to_highres(src)
                    if high_res_url not in image_urls:
                        image_urls.append(high_res_url)

        if not image_urls:
            raise Exception("No images found on page")

        logger.info(f"Extracted {len(image_urls)} image URLs")
        return image_urls

    def _convert_to_highres(self, url: str) -> str:
        """
        Convert Yupoo thumbnail URL to highest available resolution.

        Yupoo URL structure: https://photo.yupoo.com/{user}/{hash}/{size}.jpg
        Size variants: small.jpg, medium.jpg, big.jpg, square.jpg
        Highest resolution available: big.jpg

        Examples:
        - .../hash/small.jpg  → .../hash/big.jpg
        - .../hash/medium.jpg → .../hash/big.jpg
        """
        # Ensure https first
        if url.startswith('//'):
            url = 'https:' + url
        elif url.startswith('http://'):
            url = url.replace('http://', 'https://')

        # Replace any size variant with big.jpg (highest resolution)
        url = re.sub(
            r'/(?:small|medium|square|thumb)\.jpg',
            '/big.jpg',
            url,
            flags=re.IGNORECASE
        )

        # Also handle _size suffix patterns (some CDN variants)
        url = re.sub(
            r'_(small|medium|square|thumb|middle)(\.jpg)',
            r'_big\2',
            url,
            flags=re.IGNORECASE
        )

        return url

    def extract_text_content(self, page) -> str:
        """
        Extract album DESCRIPTION from Yupoo page (e.g., "Factory price 249...").
        IMPORTANT: We want the product description, NOT the website header/slogan.
        """
        logger.info("Extracting text content...")

        # Known bad strings to filter out (website headers/slogans)
        bad_phrases = [
            'thousands of styles',
            'ten thousand styles',
            'international brand',
            'daily update',
            '万种款式',
            '国际大牌',
            '每日更新',
            '工厂直销',
        ]

        def is_valid_description(text: str) -> bool:
            """Check if text is a valid product description, not a generic header."""
            if not text or len(text) < 10:
                return False
            text_lower = text.lower()
            for bad in bad_phrases:
                if bad in text_lower:
                    logger.debug(f"Filtered out bad phrase: '{text[:50]}...'")
                    return False
            return True

        # PRIORITY 1: Look for album-specific description containers
        # These are typically right below or beside the main image preview
        description_selectors = [
            '.show__header-note',           # Primary description container
            '.showalbum__note',             # Album note section
            '.album__note',                 # Album note alt
            '.html_content',                # HTML content block
            '.show__desc',                  # Show description
            '.showalbum__desc',             # Album description
            'div.description',              # Generic description div
            '.show__info .note',            # Info note section
            'div[class*="note"]',           # Any note container
        ]

        for selector in description_selectors:
            try:
                elements = page.locator(selector).all()
                for elem in elements:
                    if elem.is_visible(timeout=500):
                        desc_text = elem.inner_text().strip()
                        if is_valid_description(desc_text):
                            logger.info(f"[TEXT EXTRACTION] Found via {selector}")
                            logger.info(f"[TEXT PREVIEW] First 50 chars: '{desc_text[:50]}'")
                            return desc_text
            except Exception as e:
                logger.debug(f"Selector {selector} failed: {e}")
                continue

        # PRIORITY 2: Look for any text containing price/size keywords (product info)
        # This catches descriptions like "Factory price 249, sizes 38-44"
        price_keywords = ['price', 'size', '价', '码', '元', '￥', '$', 'factory']
        try:
            # Search all text nodes on the page
            all_text_elements = page.locator('div, p, span').all()
            for elem in all_text_elements[:100]:  # Limit search
                try:
                    if elem.is_visible(timeout=100):
                        text = elem.inner_text().strip()
                        if text and len(text) > 15 and len(text) < 500:
                            text_lower = text.lower()
                            if any(kw in text_lower for kw in price_keywords):
                                if is_valid_description(text):
                                    logger.info(f"[TEXT EXTRACTION] Found via keyword search")
                                    logger.info(f"[TEXT PREVIEW] First 50 chars: '{text[:50]}'")
                                    return text
                except:
                    continue
        except Exception as e:
            logger.debug(f"Keyword search failed: {e}")

        # PRIORITY 3: Get the album title (but not the website header)
        title_selectors = [
            '.showalbum__title',
            '.album__title',
            '.show__title',
            'h1.title',
        ]

        for selector in title_selectors:
            try:
                title = page.locator(selector).first
                if title.is_visible(timeout=500):
                    title_text = title.inner_text().strip()
                    if is_valid_description(title_text):
                        logger.info(f"[TEXT EXTRACTION] Using title from {selector}")
                        logger.info(f"[TEXT PREVIEW] First 50 chars: '{title_text[:50]}'")
                        return title_text
            except:
                continue

        # FALLBACK: Return empty and log warning
        logger.warning("[TEXT EXTRACTION] No valid description found - returning empty")
        logger.warning("This product may need manual description input")
        return ""

    def _extract_image_id(self, url: str) -> Optional[str]:
        """
        Extract unique image ID from Yupoo image URL.
        Example: .../pinpainvxie_v/0d4283f0/medium.jpg -> 0d4283f0
        """
        if not url:
            return None

        # Pattern 1: Standard Yupoo format with hash directory
        match = re.search(r'/([a-f0-9]{8,})/(?:small|medium|big|square)\.', url)
        if match:
            return match.group(1)

        # Pattern 2: Hash in path segment
        parts = url.split('/')
        for part in reversed(parts):
            clean_part = part.split('.')[0]
            if re.match(r'^[a-f0-9]{6,}$', clean_part):
                return clean_part

        return None

    def _fetch_image_via_browser(self, page, url: str) -> Optional[list]:
        """Attempt to download image bytes via in-browser fetch. Returns byte list or None."""
        return page.evaluate("""
            async (url) => {
                try {
                    const resp = await fetch(url, {credentials: 'include'});
                    if (!resp.ok) return null;
                    const buf = await resp.arrayBuffer();
                    return Array.from(new Uint8Array(buf));
                } catch (e) {
                    return null;
                }
            }
        """, url)

    def _extract_image_via_canvas(self, page, img_element, save_path: Path) -> bool:
        """
        Extract an already-loaded <img> element's pixel data via canvas.

        This bypasses Yupoo's anti-hotlink protection because the image is
        already rendered in the browser DOM. We draw it onto a canvas and
        export as JPEG base64.

        Returns True if successful, False otherwise.
        """
        import base64
        try:
            data_url = page.evaluate("""
                (img) => {
                    try {
                        if (!img || !img.naturalWidth || img.naturalWidth < 50) return null;
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        return canvas.toDataURL('image/jpeg', 0.92);
                    } catch (e) {
                        return null;  // CORS tainted canvas
                    }
                }
            """, img_element.element_handle())

            if data_url and data_url.startswith('data:image'):
                # Strip the data URL prefix: "data:image/jpeg;base64,..."
                b64_data = data_url.split(',', 1)[1]
                image_bytes = base64.b64decode(b64_data)
                if len(image_bytes) > 5000:
                    with open(save_path, 'wb') as f:
                        f.write(image_bytes)
                    return True
        except Exception as e:
            logger.debug(f"[CANVAS] Canvas extraction failed: {e}")
        return False

    def _close_viewer(self, page, original_url: str, album_url: str) -> None:
        """Close the Yupoo image viewer overlay and ensure we're back on the album page."""
        try:
            # Press Escape to close the viewer modal
            page.keyboard.press('Escape')
            time.sleep(0.5)

            # Verify viewer is closed
            try:
                viewer = page.locator('img.viewer_img')
                if viewer.is_visible(timeout=500):
                    # Still open — try Escape again
                    page.keyboard.press('Escape')
                    time.sleep(0.5)
            except:
                pass  # Viewer gone

            # If URL changed (some Yupoo configs navigate to a photo page), go back
            current_url = page.url
            if current_url != original_url and '/albums/' not in current_url:
                logger.debug("[VIEWER] URL changed, navigating back to album")
                page.goto(album_url, timeout=15000)
                page.wait_for_load_state('domcontentloaded', timeout=10000)
                time.sleep(1)
        except Exception as e:
            logger.debug(f"[VIEWER] Error closing viewer: {e}")
            try:
                page.goto(album_url, timeout=15000)
                page.wait_for_load_state('domcontentloaded', timeout=10000)
            except:
                pass

    def _download_via_response_intercept(self, page, img_url: str, save_path: Path) -> bool:
        """
        Download a high-res image by injecting a hidden <img> element and
        capturing the browser's network response.

        Unlike fetch(), <img> tags load with proper Referer/cookies and bypass
        Yupoo's anti-hotlink protection. We capture the response via Playwright's
        expect_response.
        """
        if not img_url:
            return False
        if img_url.startswith('//'):
            img_url = 'https:' + img_url
        elif img_url.startswith('http://'):
            img_url = img_url.replace('http://', 'https://')

        try:
            # Use a unique ID so we can match the exact response
            unique_id = f"__hm_{int(time.time() * 1000)}"

            # Expect the response, then trigger the image load
            filename = img_url.split('/')[-1]
            with page.expect_response(
                lambda r: filename in r.url and r.status == 200,
                timeout=15000
            ) as resp_info:
                page.evaluate(f"""
                    (url) => {{
                        const img = document.createElement('img');
                        img.id = '{unique_id}';
                        img.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;';
                        document.body.appendChild(img);
                        img.src = url;
                    }}
                """, img_url)

            response = resp_info.value
            if response.ok:
                image_bytes = response.body()
                if len(image_bytes) > 5000:
                    with open(save_path, 'wb') as f:
                        f.write(image_bytes)
                    logger.info(f"[INTERCEPT] Success: {save_path.name} ({len(image_bytes):,} bytes)")
                    # Clean up hidden img
                    page.evaluate(f"document.getElementById('{unique_id}')?.remove()")
                    return True
                else:
                    logger.warning(f"[INTERCEPT] Response too small: {len(image_bytes)} bytes")

            # Clean up
            page.evaluate(f"document.getElementById('{unique_id}')?.remove()")

        except Exception as e:
            logger.debug(f"[INTERCEPT] Failed for {img_url[-50:]}: {e}")
            # Clean up on error
            try:
                page.evaluate(f"document.getElementById('{unique_id}')?.remove()")
            except:
                pass

        return False

    def _download_image_click_through(self, page, img_elem, save_path: Path, album_url: str) -> None:
        """
        Download high-resolution image from Yupoo gallery.

        Strategy priority:
        1. RESPONSE INTERCEPT: Inject a hidden <img> with data-origin-src URL,
           capture the browser's network response. <img> tags bypass anti-hotlink
           because they include proper Referer/cookies unlike fetch().
        2. RESPONSE INTERCEPT (big.jpg): Same approach with data-src URL.
        3. VIEWER: Open the image viewer overlay, screenshot the full-res image.
        4. THUMBNAIL SCREENSHOT: Last resort fallback.
        """
        origin_src = img_elem.get_attribute('data-origin-src') or ''
        data_src = img_elem.get_attribute('data-src') or ''
        logger.info(f"[DOWNLOAD] Starting {save_path.name}")

        downloaded = False

        # ── Strategy 1: Response intercept with data-origin-src (full original) ──
        if origin_src and not downloaded:
            logger.info(f"[DOWNLOAD] Trying data-origin-src intercept: ...{origin_src[-60:]}")
            downloaded = self._download_via_response_intercept(page, origin_src, save_path)

        # ── Strategy 2: Response intercept with data-src (big.jpg) ──
        if data_src and not downloaded:
            logger.info(f"[DOWNLOAD] Trying data-src intercept: ...{data_src[-60:]}")
            downloaded = self._download_via_response_intercept(page, data_src, save_path)

        # ── Strategy 3: Open viewer via mouse click, screenshot full-res ──
        if not downloaded:
            original_url = page.url
            try:
                logger.info(f"[VIEWER] Opening viewer for {save_path.name}")
                img_elem.scroll_into_view_if_needed()
                time.sleep(0.3)

                box = img_elem.bounding_box()
                if not box:
                    raise Exception("Could not get bounding box")
                page.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)

                viewer_img = page.locator('img.viewer_img').first
                viewer_img.wait_for(state='visible', timeout=8000)

                try:
                    page.wait_for_function("""
                        () => {
                            const img = document.querySelector('img.viewer_img');
                            return img && img.complete && img.naturalWidth > 100;
                        }
                    """, timeout=10000)
                except PlaywrightTimeoutError:
                    pass

                time.sleep(0.5)

                # Try canvas extraction from viewer image
                if self._extract_image_via_canvas(page, viewer_img, save_path):
                    logger.info(f"[VIEWER] Canvas extraction: {save_path.name}")
                    downloaded = True
                else:
                    # Screenshot the viewer image
                    viewer_img.screenshot(path=str(save_path))
                    logger.info(f"[VIEWER] Screenshot viewer image: {save_path.name}")
                    downloaded = True

                self._close_viewer(page, original_url, album_url)
            except Exception as e:
                logger.warning(f"[VIEWER] Failed ({e})")
                self._close_viewer(page, original_url, album_url)

        # ── Strategy 4: Screenshot the thumbnail as last resort ──
        if not downloaded:
            try:
                img_elem.screenshot(path=str(save_path))
                logger.info(f"[FALLBACK] Thumbnail screenshot: {save_path.name}")
            except:
                logger.error(f"[DOWNLOAD] All methods failed for {save_path.name}")

    def download_images_with_browser(self, page, product_id: str) -> tuple[Path, Optional[int]]:
        """
        Download images by screenshotting img elements (bypasses all hotlink protection).
        Returns: (product_folder, hero_image_index)

        Hero Selection Logic (PRIORITY ORDER):
        1. Look for AutoCover image (.showalbumheader__gallerycover img or img.autocover)
           - This is the dedicated cover photo next to the title - high quality Main Image
        2. If no AutoCover found, fall back to first gallery image

        Download Order:
        - AutoCover saved as 00_main.jpg (hero)
        - Gallery images saved as 01.jpg, 02.jpg, etc.
        - Deduplication: If AutoCover appears in gallery, exclude it from gallery list
        """
        product_folder = self.tmp_dir / product_id
        product_folder.mkdir(exist_ok=True)

        logger.info(f"[IMAGE CAPTURE] Starting image capture for {product_id}")

        # STEP 1: Look for the AUTOCOVER image (dedicated cover photo)
        autocover_element = None
        autocover_image_id = None
        autocover_selectors = [
            '.showalbumheader__gallerycover img',  # Primary: Gallery cover in header
            'img.autocover',                        # Direct autocover class
            '.showalbum__cover img',                # Album cover container
            '.album-cover img',                     # Alternative cover selector
        ]

        for selector in autocover_selectors:
            try:
                cover_img = page.locator(selector).first
                if cover_img.is_visible(timeout=1000):
                    cover_src = cover_img.get_attribute('src') or cover_img.get_attribute('data-src') or ''
                    if cover_src:
                        autocover_image_id = self._extract_image_id(cover_src)
                        if autocover_image_id:
                            autocover_element = cover_img
                            logger.info(f"[AUTOCOVER] Found cover image ID: {autocover_image_id} via {selector}")
                            break
            except Exception as e:
                logger.debug(f"AutoCover selector {selector} failed: {e}")
                continue

        if not autocover_element:
            logger.info("[AUTOCOVER] No dedicated cover image found - will use first gallery image as hero")

        # STEP 2: Get ALL gallery images from the grid
        gallery_elements = page.locator('.showalbum__children img').all()

        if not gallery_elements:
            # Fallback: any img tag with yupoo/photo in src
            logger.warning("[IMAGE CAPTURE] No .showalbum__children images, using fallback")
            gallery_elements = page.locator('img').all()
            filtered = []
            for elem in gallery_elements:
                try:
                    src = elem.get_attribute('src') or elem.get_attribute('data-src') or ''
                    if 'yupoo' in src or 'photo' in src:
                        filtered.append(elem)
                except:
                    pass
            gallery_elements = filtered

        # STEP 3: Build deduplication set - exclude AutoCover from gallery if present
        gallery_to_download = []
        for elem in gallery_elements:
            try:
                src = elem.get_attribute('src') or elem.get_attribute('data-src') or ''
                img_id = self._extract_image_id(src)

                # Skip if this is the same as the AutoCover (deduplication)
                if autocover_image_id and img_id == autocover_image_id:
                    logger.info(f"[DEDUP] Skipping gallery image {img_id} - same as AutoCover")
                    continue

                gallery_to_download.append((elem, img_id))
            except:
                gallery_to_download.append((elem, None))

        logger.info(f"[IMAGE CAPTURE] Gallery images after dedup: {len(gallery_to_download)}")

        # STEP 4: Download images in correct order
        successful_downloads = 0
        hero_image_index = 0  # AutoCover is always index 0

        # 4a: Download AutoCover as 00_main.jpg (if found)
        # AutoCover uses screenshot (small size) — kept for Agent 2 research.
        # Agent 4 will replace it with the optimized WebP later.
        if autocover_element:
            try:
                save_path = product_folder / "00_main.jpg"
                autocover_element.screenshot(path=str(save_path))

                # Validate
                from PIL import Image
                img = Image.open(save_path)
                img.verify()
                successful_downloads += 1
                logger.info(f"[AUTOCOVER] Saved as 00_main.jpg (HERO) via screenshot")
            except Exception as e:
                logger.warning(f"[AUTOCOVER] Failed to capture cover image: {e}")
                autocover_element = None  # Fall back to gallery[0] as hero

        # 4b: Download gallery images via click-through for high-res
        # We click each thumbnail to open the detail view, download the full image,
        # then navigate back. After navigating back, DOM refs are stale, so we
        # re-locate gallery elements by index each iteration.
        max_gallery_images = 15  # Reasonable limit
        album_url = page.url  # Save current URL for navigation back

        # Build list of image IDs to download (preserving order and dedup decisions)
        gallery_image_ids = [(img_id, idx) for idx, (_, img_id) in enumerate(gallery_to_download[:max_gallery_images])]
        total_gallery = len(gallery_image_ids)

        for download_idx, (img_id, original_idx) in enumerate(gallery_image_ids):
            try:
                # Re-locate all gallery images fresh (DOM is rebuilt after each navigation)
                current_gallery = page.locator('.showalbum__children img').all()
                if not current_gallery:
                    logger.warning("[IMAGE CAPTURE] Cannot re-locate gallery images after navigation")
                    break

                # Find the matching element by scanning for the image ID, or by position
                img_elem = None
                if img_id:
                    # Match by image ID (most reliable)
                    skip_count = 0
                    for elem in current_gallery:
                        try:
                            src = elem.get_attribute('src') or elem.get_attribute('data-src') or ''
                            elem_id = self._extract_image_id(src)
                            # Skip autocover duplicates
                            if autocover_image_id and elem_id == autocover_image_id:
                                continue
                            if elem_id == img_id:
                                img_elem = elem
                                break
                        except:
                            continue

                if not img_elem:
                    # Fallback: use position-based indexing (skip autocover if present)
                    non_cover_idx = 0
                    for elem in current_gallery:
                        try:
                            src = elem.get_attribute('src') or elem.get_attribute('data-src') or ''
                            elem_id = self._extract_image_id(src)
                            if autocover_image_id and elem_id == autocover_image_id:
                                continue
                            if non_cover_idx == download_idx:
                                img_elem = elem
                                break
                            non_cover_idx += 1
                        except:
                            non_cover_idx += 1
                            continue

                if not img_elem:
                    logger.warning(f"[IMAGE CAPTURE] Could not re-locate gallery image {download_idx}")
                    continue

                if not img_elem.is_visible():
                    # Scroll it into view
                    img_elem.scroll_into_view_if_needed()
                    time.sleep(0.3)

                # Determine save path
                if not autocover_element and download_idx == 0:
                    save_path = product_folder / "00_main.jpg"
                    logger.info(f"[FALLBACK] Using gallery[0] as hero (00_main.jpg)")
                else:
                    file_idx = download_idx + 1 if autocover_element else download_idx
                    save_path = product_folder / f"{file_idx:02d}.jpg"

                # Click through to detail view and download high-res
                self._download_image_click_through(page, img_elem, save_path, album_url)

                # Validate
                from PIL import Image
                img = Image.open(save_path)
                img.verify()
                successful_downloads += 1
                logger.info(f"[IMAGE CAPTURE] Captured {save_path.name} ({download_idx + 1}/{total_gallery})")
            except Exception as e:
                logger.warning(f"[IMAGE CAPTURE] Error capturing gallery image {download_idx}: {e}")
                # Make sure we're back on the album page for next iteration
                try:
                    if page.url != album_url:
                        page.goto(album_url, timeout=15000)
                        page.wait_for_load_state('domcontentloaded', timeout=10000)
                except:
                    pass

        # STEP 5: Summary
        logger.info(f"[IMAGE CAPTURE] Successfully captured {successful_downloads} images")

        if autocover_element:
            logger.info("[HERO RESULT] AutoCover image used as hero (00_main.jpg)")
        else:
            logger.info("[HERO RESULT] First gallery image used as hero (00_main.jpg)")

        if successful_downloads == 0:
            raise Exception("Failed to capture any images")

        return product_folder, hero_image_index

    def scrape(self, url: str, product_id: str) -> ProductData:
        """
        Scrape Yupoo product page.
        Handles password protection, extracts images and text.
        """
        logger.info(f"Scraping Yupoo URL: {url}")

        with sync_playwright() as p:
            # Launch browser
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            )
            page = context.new_page()

            try:
                # Navigate to URL
                logger.info("Loading page...")
                page.goto(url, wait_until='domcontentloaded', timeout=60000)

                # Handle password if needed
                self.handle_password_prompt(page)

                # Wait for content to load (use load instead of networkidle for faster processing)
                try:
                    page.wait_for_load_state('load', timeout=30000)
                except:
                    logger.warning("Page load timeout, but continuing anyway...")

                # Give the page a moment to render
                page.wait_for_timeout(3000)

                # Extract supplier ID
                supplier_id = self.extract_supplier_id(url)

                # Extract text content first (more important than images)
                raw_chinese = self.extract_text_content(page)

                # Extract images (if this fails, we'll still have the text)
                try:
                    image_urls = self.extract_images(page)
                except Exception as e:
                    logger.error(f"Failed to extract images: {e}")
                    # Try a simpler approach - just get any img tags
                    logger.info("Attempting fallback image extraction...")
                    image_urls = []
                    try:
                        imgs = page.locator('img').all()
                        for img in imgs[:20]:  # Limit to 20 images
                            src = img.get_attribute('src') or img.get_attribute('data-src')
                            if src and ('yupoo' in src or 'jpg' in src.lower() or 'png' in src.lower()):
                                high_res = self._convert_to_highres(src)
                                if high_res not in image_urls:
                                    image_urls.append(high_res)
                    except Exception as e2:
                        logger.error(f"Fallback image extraction also failed: {e2}")

                if not image_urls:
                    raise Exception("No images found on page after all extraction attempts")

                # Download images while we still have browser context
                logger.info("Downloading images via browser...")
                local_folder, hero_index = self.download_images_with_browser(page, product_id)

                # Create timestamp
                scraped_at = datetime.utcnow().isoformat() + 'Z'

                logger.info(f"Scraping complete for {product_id}")

                # Store the local folder path in the ProductData (we'll use it later)
                product_data = ProductData(
                    supplier_id=supplier_id,
                    raw_chinese=raw_chinese,
                    english_name_draft="",  # Will be filled by translation
                    material_info="",  # Will be filled by translation
                    image_urls=image_urls,
                    scraped_at=scraped_at
                )
                # Attach local folder and hero index as attributes
                product_data._local_folder = local_folder
                product_data._hero_index = hero_index if hero_index is not None else 0

                return product_data

            finally:
                browser.close()

    def process_product(self, url: str, product_id: str):
        """
        Override base class to use browser-based image downloading.
        Includes brand hint extraction for hybrid search seeding.

        Returns dict with ALL fields for Google Sheet:
        - Status, Supplier_ID, Raw_Chinese
        - English_Name_Draft (with [Brand: X] tag if found)
        - English_Full_Translation (complete translation for Agent 2/3 context)
        - Extracted_Brand (brand from translation, for unknown brands like Brunello Cucinelli)
        - Material_Info, GDrive_Folder_Link, Main_Image_File_ID, Image_Count, Scraped_At
        """
        from openai import OpenAI
        import os

        logger.info(f"Processing product {product_id} from {url}")

        try:
            # Step 1: Scrape (includes downloading images)
            product_data = self.scrape(url, product_id)

            # Get the local folder and hero index from the product data
            local_folder = getattr(product_data, '_local_folder', None)
            hero_index = getattr(product_data, '_hero_index', 0)
            if not local_folder:
                raise Exception("Local folder not found after scraping")

            # Step 2: Extract brand hint BEFORE translation (from raw Chinese brackets)
            # This catches 【GUCCI】 patterns
            brand_hint_from_brackets = self.extract_brand_hint(product_data.raw_chinese)

            # Step 3: Translate (now returns full_translation + extracted_brand)
            translation = self.translate_chinese(product_data.raw_chinese)

            # Step 4: Determine final brand hint
            # Priority: bracket extraction > translation extraction
            final_brand_hint = brand_hint_from_brackets or translation.extracted_brand

            # Step 5: Prepend brand tag to English_Name_Draft if brand was found
            english_name_with_brand = translation.english_name_draft
            if final_brand_hint:
                # Format: [Brand: GUCCI] Original Translation
                english_name_with_brand = f"[Brand: {final_brand_hint}] {translation.english_name_draft}"
                logger.info(f"[BRAND TAG] Prepended brand hint: {english_name_with_brand[:60]}...")

            # Step 6: Upload images (to Drive or Cloudinary)
            upload_result = self.upload_images(local_folder, product_id, hero_index)

            # Step 7: Cleanup
            self.cleanup_tmp(product_id)

            # Return complete data for sheet update (NEW FIELDS ADDED)
            return {
                'Status': 'READY_FOR_RESEARCH',
                'Supplier_ID': product_data.supplier_id,
                'Raw_Chinese': product_data.raw_chinese,
                'English_Full_Translation': translation.full_translation,  # NEW: Full context for Agent 2/3
                'English_Name_Draft': english_name_with_brand,  # Now includes [Brand: X] tag
                'Extracted_Brand': final_brand_hint or '',  # NEW: For unknown brands like Brunello Cucinelli
                'Material_Info': translation.material_info,
                'Product_Description': translation.extracted_description,  # NEW: For SEO Agent 3
                'Storage_Folder_URL': upload_result.folder_url,
                'Main_Image_File_ID': upload_result.main_image_id,
                'Image_Count': upload_result.image_count,
                'Scraped_At': product_data.scraped_at
            }

        except Exception as e:
            logger.error(f"Failed to process product {product_id}: {e}")
            # Cleanup on failure
            self.cleanup_tmp(product_id)
            raise

    def discover_albums(self, gallery_url: str) -> List[dict]:
        """
        Discover all product album URLs from a Yupoo gallery/category page.

        Args:
            gallery_url: URL of a Yupoo gallery page (e.g., seller's main page or category)

        Returns:
            List of dicts with 'url' and 'supplier_id' for each discovered album
        """
        logger.info(f"[ALBUM DISCOVERY] Scanning gallery: {gallery_url}")

        discovered_albums = []

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            )
            page = context.new_page()

            try:
                # Navigate to gallery page
                page.goto(gallery_url, wait_until='domcontentloaded', timeout=60000)

                # Handle password if needed
                self.handle_password_prompt(page)

                # Wait for content
                page.wait_for_load_state('load', timeout=30000)
                page.wait_for_timeout(2000)

                # Scroll to load all albums (lazy loading)
                self.scroll_to_bottom(page, delay_ms=500)

                # Extract album links using multiple selectors
                album_selectors = [
                    'a.album__main',           # Main album link wrapper
                    'a[href*="/albums/"]',     # Any link containing /albums/
                    '.categories__children a', # Category children links
                    '.showindex__children a',  # Index page children
                    '.album-list a',           # Album list items
                    '.showindex__galleryctn a',  # Gallery container links
                ]

                found_urls = set()

                for selector in album_selectors:
                    try:
                        links = page.locator(selector).all()
                        for link in links:
                            href = link.get_attribute('href')
                            if href:
                                # Normalize URL
                                if href.startswith('//'):
                                    href = 'https:' + href
                                elif href.startswith('/'):
                                    # Relative URL - build full URL
                                    from urllib.parse import urlparse
                                    parsed = urlparse(gallery_url)
                                    href = f"{parsed.scheme}://{parsed.netloc}{href}"

                                # Only include album URLs (not category pages)
                                if '/albums/' in href or '/album/' in href:
                                    found_urls.add(href)
                    except Exception as e:
                        logger.debug(f"Selector {selector} failed: {e}")
                        continue

                # Also try extracting from data attributes
                try:
                    album_elements = page.locator('[data-album-id]').all()
                    for elem in album_elements:
                        album_id = elem.get_attribute('data-album-id')
                        if album_id:
                            # Build album URL from base
                            from urllib.parse import urlparse
                            parsed = urlparse(gallery_url)
                            album_url = f"{parsed.scheme}://{parsed.netloc}/albums/{album_id}"
                            found_urls.add(album_url)
                except Exception as e:
                    logger.debug(f"Data attribute extraction failed: {e}")

                logger.info(f"[ALBUM DISCOVERY] Found {len(found_urls)} unique album URLs")

                # Convert to list of dicts with extracted supplier IDs
                for url in found_urls:
                    try:
                        supplier_id = self.extract_supplier_id(url)
                        discovered_albums.append({
                            'url': url,
                            'supplier_id': supplier_id
                        })
                    except Exception as e:
                        logger.warning(f"Could not extract supplier ID from {url}: {e}")
                        # Still include the URL but without supplier_id
                        discovered_albums.append({
                            'url': url,
                            'supplier_id': None
                        })

            except PlaywrightTimeoutError as e:
                logger.error(f"[ALBUM DISCOVERY] Timeout loading gallery: {e}")
            except Exception as e:
                logger.error(f"[ALBUM DISCOVERY] Error: {e}")
            finally:
                browser.close()

        logger.info(f"[ALBUM DISCOVERY] Discovered {len(discovered_albums)} albums")
        return discovered_albums


# Future miners would follow the same pattern:

# class WeidianMiner(BaseMiner):
#     """Scraper for Weidian product pages."""
#     def extract_supplier_id(self, url: str) -> str:
#         # Weidian-specific logic
#         pass
#
#     def scrape(self, url: str, product_id: str) -> ProductData:
#         # Weidian-specific scraping logic
#         pass


# class AlibabaMiner(BaseMiner):
#     """Scraper for 1688/Alibaba product pages."""
#     def extract_supplier_id(self, url: str) -> str:
#         # Alibaba-specific logic
#         pass
#
#     def scrape(self, url: str, product_id: str) -> ProductData:
#         # Alibaba-specific scraping logic
#         pass
