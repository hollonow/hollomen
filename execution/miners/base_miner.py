#!/usr/bin/env python3
"""
BASE MINER: Abstract class defining the scraping interface for all supplier miners.
"""

import json
import logging
import os
import shutil
import sys
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Any, Union
from urllib.parse import urlparse

from PIL import Image
from playwright.sync_api import Page, sync_playwright
from openai import OpenAI

# Cloudinary uploader
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from cloudinary_uploader import CloudinaryUploader, CloudinaryUploadResult

logger = logging.getLogger(__name__)


@dataclass
class ProductData:
    """Structured product data extracted from supplier site."""
    supplier_id: str
    raw_chinese: str
    english_name_draft: str
    material_info: str
    image_urls: List[str]
    scraped_at: str


@dataclass
class UploadResult:
    """Unified result of uploading images (Drive or Cloudinary)."""
    folder_url: str
    main_image_id: str
    image_count: int


@dataclass
class TranslationResult:
    """Result of translating Chinese text with full context for downstream agents."""
    english_name_draft: str          # Short product name
    material_info: str               # Extracted material details
    full_translation: str            # Complete English translation of all text
    extracted_brand: Optional[str]   # Brand name if detected in text (e.g., "Brunello Cucinelli")
    extracted_description: str       # Detailed product description


class BaseMiner(ABC):
    """Abstract base class for all supplier miners."""

    def __init__(
        self,
        openai_api_key: str,
        cloudinary_cloud_name: str = None,
        cloudinary_api_key: str = None,
        cloudinary_api_secret: str = None
    ):
        """
        Initialize miner with API credentials.

        Args:
            openai_api_key: OpenAI API key for translation
            cloudinary_*: Cloudinary credentials for image storage
        """
        self.openai_client = OpenAI(api_key=openai_api_key)

        if not cloudinary_cloud_name:
            raise ValueError("Cloudinary credentials required. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.")

        self.cloudinary = CloudinaryUploader(
            cloud_name=cloudinary_cloud_name,
            api_key=cloudinary_api_key,
            api_secret=cloudinary_api_secret
        )
        logger.info("Using Cloudinary for image storage")

        # Temp directory for downloads
        self.tmp_dir = Path('.tmp')
        self.tmp_dir.mkdir(exist_ok=True)

    @abstractmethod
    def scrape(self, url: str, product_id: str) -> ProductData:
        """
        Scrape product data from supplier URL.
        Must be implemented by each supplier-specific miner.
        """
        pass

    @abstractmethod
    def extract_supplier_id(self, url: str) -> str:
        """
        Extract supplier's unique product ID from URL.
        Must be implemented by each supplier-specific miner.
        """
        pass

    def scroll_to_bottom(self, page: Page, delay_ms: int = 500) -> None:
        """
        Scroll to bottom of page to trigger lazy loading.
        Standard implementation - can be overridden if needed.
        """
        logger.info("Scrolling to bottom to load all images...")

        previous_height = page.evaluate("document.body.scrollHeight")

        while True:
            # Scroll to bottom
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(delay_ms)

            # Check if new content loaded
            new_height = page.evaluate("document.body.scrollHeight")
            if new_height == previous_height:
                break
            previous_height = new_height

        logger.info("Finished scrolling - all content loaded")

    def download_image(self, url: str, save_path: Path, max_retries: int = 3) -> bool:
        """
        Download image from URL with retry logic.
        Returns True if successful, False otherwise.
        """
        import requests

        # Use headers to avoid being blocked
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://yupoo.com/',
        }

        for attempt in range(max_retries):
            try:
                response = requests.get(url, headers=headers, timeout=30, stream=True)
                response.raise_for_status()

                # Save image
                with open(save_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)

                # Validate image
                try:
                    img = Image.open(save_path)
                    img.verify()
                    logger.debug(f"Downloaded: {save_path.name}")
                    return True
                except Exception as e:
                    logger.error(f"Invalid image file {save_path.name}: {e}")
                    save_path.unlink(missing_ok=True)
                    return False

            except requests.RequestException as e:
                wait_time = 2 ** attempt
                logger.warning(f"Download attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    logger.info(f"Retrying in {wait_time}s...")
                    import time
                    time.sleep(wait_time)
                else:
                    logger.error(f"Failed to download {url} after {max_retries} attempts")
                    return False

        return False

    def download_images(self, image_urls: List[str], product_id: str) -> Path:
        """
        Download all images to temporary directory.
        Returns path to product folder.
        """
        product_folder = self.tmp_dir / product_id
        product_folder.mkdir(exist_ok=True)

        logger.info(f"Downloading {len(image_urls)} images for {product_id}...")

        successful_downloads = 0
        for idx, url in enumerate(image_urls):
            save_path = product_folder / f"image_{idx}.jpg"
            if self.download_image(url, save_path):
                successful_downloads += 1

        logger.info(f"Successfully downloaded {successful_downloads}/{len(image_urls)} images")

        if successful_downloads == 0:
            raise Exception("Failed to download any images")

        return product_folder

    def translate_chinese(self, raw_text: str) -> TranslationResult:
        """
        Translate Chinese text to English using GPT-4o-mini.
        Provides FULL translation plus structured extraction for downstream agents.

        Returns:
            TranslationResult with:
            - english_name_draft: Short product name
            - material_info: Material/fabric details
            - full_translation: Complete English translation (for Agent 2/3 context)
            - extracted_brand: Brand name if mentioned (e.g., "Brunello Cucinelli")
            - extracted_description: Detailed product description
        """
        if not raw_text or not raw_text.strip():
            logger.warning("Empty raw_chinese text - skipping translation")
            return TranslationResult(
                english_name_draft="",
                material_info="",
                full_translation="",
                extracted_brand=None,
                extracted_description=""
            )

        logger.info("Translating Chinese text with full context extraction...")

        system_prompt = """You are a translator for luxury fashion e-commerce. Translate and extract information from this Chinese product listing.

IMPORTANT: Some brands may be less common (e.g., "Brunello Cucinelli", "Loro Piana", "Santoni").
If you see a brand name (Chinese or English), extract it - even if you're not 100% sure it's a luxury brand.

Return JSON with:
{
  "full_translation": "Complete literal English translation of ALL text (keep numbers, sizes, prices as-is)",
  "english_name_draft": "Short product name (e.g., 'Men's Leather Loafer' or 'Suede Chelsea Boot')",
  "material_info": "Extracted material/fabric details (e.g., '100% Genuine Leather, Rubber Sole')",
  "extracted_brand": "Brand name if mentioned (e.g., 'Gucci', 'Brunello Cucinelli', 'Tod's') or null if none found",
  "extracted_description": "Detailed product description for SEO (style, features, occasion)"
}

Rules:
1. full_translation must be COMPLETE - translate everything, keep numbers/prices
2. extracted_brand: Look for brand names in brackets 【】, [], or mentioned in text
3. If brand is in Chinese (e.g., 古驰=Gucci, 迪奥=Dior), translate to English
4. Do not invent or guess brands - only extract what's clearly mentioned"""

        user_prompt = f"Chinese Text:\n{raw_text}"

        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_format={"type": "json_object"},
                temperature=0.3
            )

            result = json.loads(response.choices[0].message.content)

            # Log extraction results
            extracted_brand = result.get('extracted_brand')
            logger.info(f"[TRANSLATION] Name: {result.get('english_name_draft', 'N/A')}")
            if extracted_brand:
                logger.info(f"[TRANSLATION] Brand detected: {extracted_brand}")
            else:
                logger.info("[TRANSLATION] No brand detected in text")
            logger.info(f"[TRANSLATION] Full translation length: {len(result.get('full_translation', ''))} chars")

            return TranslationResult(
                english_name_draft=result.get('english_name_draft', ''),
                material_info=result.get('material_info', ''),
                full_translation=result.get('full_translation', ''),
                extracted_brand=extracted_brand,
                extracted_description=result.get('extracted_description', '')
            )

        except Exception as e:
            logger.error(f"Translation failed: {e}")
            return TranslationResult(
                english_name_draft="",
                material_info="",
                full_translation="",
                extracted_brand=None,
                extracted_description=""
            )

    def upload_images(self, local_folder: Path, product_id: str, hero_index: int = 0) -> UploadResult:
        """
        Upload images from local folder to configured storage (Drive or Cloudinary).
        Creates organized folder structure and returns URLs.

        Args:
            local_folder: Path to folder containing images
            product_id: Product identifier
            hero_index: Index of the hero/main image (default: 0)

        Returns:
            UploadResult with folder URL and main image ID
        """
        result = self.cloudinary.upload_product_images(local_folder, product_id, hero_index)
        return UploadResult(
            folder_url=result.folder_url,
            main_image_id=result.main_image_id,
            image_count=result.image_count
        )

    # Backwards compatibility alias
    def upload_to_cloudinary(self, local_folder: Path, product_id: str, hero_index: int = 0) -> UploadResult:
        """Deprecated: Use upload_images() instead."""
        return self.upload_images(local_folder, product_id, hero_index)

    def cleanup_tmp(self, product_id: str) -> None:
        """Delete temporary product folder after successful upload."""
        product_folder = self.tmp_dir / product_id
        if product_folder.exists():
            shutil.rmtree(product_folder)
            logger.debug(f"Cleaned up temp folder: {product_id}")

    def process_product(self, url: str, product_id: str) -> Dict[str, Any]:
        """
        Complete pipeline: Scrape → Download → Translate → Upload.
        Returns dict with all data to update in Google Sheet.
        """
        logger.info(f"Processing product {product_id} from {url}")

        try:
            # Step 1: Scrape
            product_data = self.scrape(url, product_id)

            # Step 2: Download images
            local_folder = self.download_images(product_data.image_urls, product_id)

            # Step 3: Translate
            translation = self.translate_chinese(product_data.raw_chinese)

            # Step 4: Upload images (to Drive or Cloudinary)
            upload_result = self.upload_images(local_folder, product_id)

            # Step 5: Cleanup
            self.cleanup_tmp(product_id)

            # Return complete data for sheet update
            return {
                'Status': 'READY_FOR_RESEARCH',
                'Supplier_ID': product_data.supplier_id,
                'Raw_Chinese': product_data.raw_chinese,
                'English_Name_Draft': translation.english_name_draft,
                'Material_Info': translation.material_info,
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
