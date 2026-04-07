#!/usr/bin/env python3
"""
Cloudinary Image Uploader - Alternative to Google Drive
Uploads product images to Cloudinary CDN with folder organization
"""

import logging
from pathlib import Path
from typing import List, Dict, Any
from dataclasses import dataclass

import cloudinary
import cloudinary.uploader
from cloudinary.utils import cloudinary_url

logger = logging.getLogger(__name__)


@dataclass
class CloudinaryUploadResult:
    """Result of uploading images to Cloudinary."""
    folder_url: str
    main_image_url: str
    main_image_id: str
    image_urls: List[str]
    image_count: int


class CloudinaryUploader:
    """Handles image uploads to Cloudinary CDN."""

    def __init__(self, cloud_name: str, api_key: str, api_secret: str):
        """
        Initialize Cloudinary uploader with credentials.

        Get credentials from: https://cloudinary.com/console
        """
        cloudinary.config(
            cloud_name=cloud_name,
            api_key=api_key,
            api_secret=api_secret,
            secure=True
        )

        self.cloud_name = cloud_name
        logger.info(f"Cloudinary uploader initialized for cloud: {cloud_name}")

    def upload_product_images(self, local_folder: Path, product_id: str, hero_index: int = 0) -> CloudinaryUploadResult:
        """
        Upload all images from local folder to Cloudinary.
        Organizes images in folders: hollomen/{product_id}/

        Image naming convention:
        - 00_main.jpg: Hero image (AutoCover or first gallery image)
        - 01.jpg, 02.jpg, etc.: Gallery images

        Args:
            local_folder: Path to folder containing images
            product_id: Product identifier for folder organization
            hero_index: Deprecated - hero is now detected by filename 00_main.jpg

        Returns:
            CloudinaryUploadResult with URLs and metadata
        """
        logger.info(f"Uploading images to Cloudinary for {product_id}...")

        # Get all image files (supports new naming: 00_main.jpg, 01.jpg, etc.)
        image_extensions = ('.jpg', '.jpeg', '.png', '.gif', '.webp')
        image_files = sorted(
            [f for f in local_folder.iterdir() if f.suffix.lower() in image_extensions],
            key=lambda x: x.name
        )

        if not image_files:
            raise Exception(f"No images found in {local_folder}")

        uploaded_urls = []
        main_image_url = None
        main_image_id = None

        for idx, image_path in enumerate(image_files):
            try:
                # Use original filename for public ID (preserves naming convention)
                filename_base = image_path.stem  # e.g., "00_main" or "01"
                public_id = f"hollomen/{product_id}/{filename_base}"

                result = cloudinary.uploader.upload(
                    str(image_path),
                    public_id=public_id,
                    resource_type="image",
                    overwrite=True,
                    tags=[product_id, "hollomen", filename_base]
                )

                # Get the secure URL
                image_url = result['secure_url']
                uploaded_urls.append(image_url)

                # Hero image is explicitly named 00_main.jpg
                if image_path.name == '00_main.jpg':
                    main_image_url = image_url
                    main_image_id = result['public_id']
                    logger.info(f"[HERO] 00_main.jpg -> {main_image_id}")

                logger.debug(f"Uploaded: {image_path.name} -> {image_url}")

            except Exception as e:
                logger.error(f"Failed to upload {image_path.name}: {e}")
                # Continue with other images even if one fails

        if not uploaded_urls:
            raise Exception("Failed to upload any images to Cloudinary")

        # Fallback: if no 00_main.jpg found, use first image
        if main_image_id is None and uploaded_urls:
            logger.warning("No 00_main.jpg found, using first image as hero")
            main_image_id = f"hollomen/{product_id}/{image_files[0].stem}"
            main_image_url = uploaded_urls[0]

        logger.info(f"Successfully uploaded {len(uploaded_urls)} images to Cloudinary")

        # Generate folder URL (view all images for this product)
        folder_url = self._get_folder_url(product_id)

        return CloudinaryUploadResult(
            folder_url=folder_url,
            main_image_url=main_image_url,
            main_image_id=main_image_id,
            image_urls=uploaded_urls,
            image_count=len(uploaded_urls)
        )

    def _get_folder_url(self, product_id: str) -> str:
        """
        Generate Cloudinary console URL to view all images in folder.
        Format: https://console.cloudinary.com/console/{cloud_name}/media_library/folders/{folder_path}
        """
        folder_path = f"hollomen/{product_id}"
        return f"https://console.cloudinary.com/console/{self.cloud_name}/media_library/folders/{folder_path}"

    def delete_product_images(self, product_id: str) -> None:
        """
        Delete all images for a product from Cloudinary.
        Useful for cleanup or re-processing.
        """
        try:
            # Delete all images in the product folder
            cloudinary.api.delete_resources_by_prefix(
                f"hollomen/{product_id}/",
                resource_type="image"
            )
            logger.info(f"Deleted all images for {product_id}")
        except Exception as e:
            logger.error(f"Failed to delete images for {product_id}: {e}")

    def get_image_info(self, public_id: str) -> Dict[str, Any]:
        """Get metadata about an uploaded image."""
        try:
            result = cloudinary.api.resource(public_id, resource_type="image")
            return result
        except Exception as e:
            logger.error(f"Failed to get info for {public_id}: {e}")
            return {}
