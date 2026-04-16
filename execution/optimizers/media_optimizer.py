#!/usr/bin/env python3
"""
MEDIA OPTIMIZER: AI-Vision Viewpoint Classification + WebP Compression Engine.
Transforms raw product images into SEO-labeled, compressed, production-ready WebP assets.
Uses Cloudinary for image storage.
"""

import base64
import io
import json
import logging
import re
import shutil
import time as _time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import requests
from openai import OpenAI
from PIL import Image



logger = logging.getLogger(__name__)

# Valid viewpoint labels for classification
VIEWPOINTS = [
    'front-view', 'side-view', 'back-view', 'sole-view',
    'overhead-view', 'inside-view', 'on-feet', 'detail-view'
]

# Cloudinary folder prefix for all uploads
CLOUDINARY_PREFIX = 'hollomen'


@dataclass
class ViewpointResult:
    """Result of GPT-4o Vision viewpoint classification for a single image."""
    file_id: str
    original_name: str
    viewpoint: str
    confidence: float


@dataclass
class OptimizationResult:
    """Final result for a product's media optimization."""
    images_processed: int
    images_compressed: int
    total_original_bytes: int
    total_compressed_bytes: int
    compression_ratio: float
    viewpoint_labels: Dict[str, str]  # {filename: viewpoint}
    new_main_image_id: str
    webp_image_count: int
    optimized_at: str
    status: str
    notes: str = ""


class MediaOptimizer:
    """
    AI-Vision Viewpoint Labeling + Professional Compression Engine.
    Downloads images from Cloudinary (or Drive), classifies viewpoints via GPT-4o Vision,
    compresses to WebP, renames with SEO slug + viewpoint, re-uploads.
    """

    # Compression settings
    TARGET_WIDTH = 1000        # pixels
    MAX_FILE_SIZE = 100_000    # 100KB
    WEBP_QUALITY = 80
    WEBP_MIN_QUALITY = 40      # Floor for iterative compression

    def __init__(
        self,
        openai_api_key: str,
        cloudinary_cloud_name: str = None,
        cloudinary_api_key: str = None,
        cloudinary_api_secret: str = None,
    ):
        self.openai_client = OpenAI(api_key=openai_api_key)
        self.tmp_dir = Path('.tmp')

        if not (cloudinary_cloud_name and cloudinary_api_key and cloudinary_api_secret):
            raise ValueError("Cloudinary credentials required.")

        import cloudinary
        import cloudinary.uploader
        import cloudinary.api
        cloudinary.config(
            cloud_name=cloudinary_cloud_name,
            api_key=cloudinary_api_key,
            api_secret=cloudinary_api_secret,
            secure=True
        )
        self._cloudinary = cloudinary
        logger.info(f"[OPTIMIZER] Using Cloudinary storage (cloud: {cloudinary_cloud_name})")

        # Run-level cost accumulators (reset per batch, reported to run_sessions)
        self._run_tokens: int = 0
        self._run_cost: float = 0.0

        logger.info("MediaOptimizer initialized")

    # ─── Cloudinary Operations ──────────────────────────────────────────

    def _cloudinary_prefix(self, product_id: str) -> str:
        # Trailing slash ensures we don't accidentally match products whose IDs
        # share a common prefix (e.g. "ABC" would otherwise match "ABC123").
        return f"{CLOUDINARY_PREFIX}/{product_id}/"

    def _list_cloudinary_images(self, product_id: str) -> List[Dict[str, str]]:
        """List all images in the Cloudinary folder for a product."""
        import cloudinary.api
        prefix = self._cloudinary_prefix(product_id)
        results = []
        next_cursor = None

        while True:
            kwargs = {'type': 'upload', 'prefix': prefix, 'max_results': 100}
            if next_cursor:
                kwargs['next_cursor'] = next_cursor
            response = cloudinary.api.resources(**kwargs)
            for r in response.get('resources', []):
                results.append({
                    'id': r['public_id'],           # Cloudinary public_id
                    'name': r['public_id'].split('/')[-1] + '.' + r['format'],
                    'format': r['format'],
                    'bytes': r.get('bytes', 0)
                })
            next_cursor = response.get('next_cursor')
            if not next_cursor:
                break

        return results

    def _download_cloudinary_image(self, public_id: str, local_path: Path) -> bool:
        """Download an image from Cloudinary using its secure URL."""
        try:
            import cloudinary
            from cloudinary.utils import cloudinary_url
            url, _ = cloudinary_url(public_id, resource_type='image', secure=True)
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            local_path.parent.mkdir(parents=True, exist_ok=True)
            with open(local_path, 'wb') as f:
                f.write(response.content)
            logger.debug(f"[CLOUDINARY] Downloaded {public_id} ({len(response.content)} bytes)")
            return True
        except Exception as e:
            logger.error(f"[CLOUDINARY] Failed to download {public_id}: {e}")
            return False

    def _delete_cloudinary_file(self, public_id: str) -> bool:
        """Delete an image from Cloudinary with retry."""
        import cloudinary.uploader
        for attempt in range(3):
            try:
                cloudinary.uploader.destroy(public_id, resource_type='image')
                logger.debug(f"[CLOUDINARY] Deleted {public_id}")
                return True
            except Exception as e:
                if attempt < 2:
                    wait = (attempt + 1) * 2
                    logger.info(f"[CLOUDINARY] Delete retry {attempt + 1}/3 for {public_id} (waiting {wait}s)")
                    _time.sleep(wait)
                else:
                    logger.warning(f"[CLOUDINARY] Failed to delete {public_id} after 3 attempts: {e}")
        return False

    def _upload_cloudinary_file(self, local_path: Path, product_id: str, filename: str) -> str:
        """Upload a WebP file to Cloudinary. Returns the public_id."""
        import cloudinary.uploader
        # filename is like 'dior-b22-front-view.webp', strip extension for public_id
        stem = Path(filename).stem
        public_id = f"{CLOUDINARY_PREFIX}/{product_id}/{stem}"
        # NOTE: Do NOT pass `folder` here — Cloudinary would prepend it to public_id,
        # producing a doubled path like hollomen/{id}/hollomen/{id}/{stem}.
        # The public_id already contains the full path including folder.
        result = cloudinary.uploader.upload(
            str(local_path),
            public_id=public_id,
            resource_type='image',
            overwrite=True,
            tags=[product_id, CLOUDINARY_PREFIX, 'optimized']
        )
        logger.debug(f"[CLOUDINARY] Uploaded {filename} -> {result['public_id']}")
        return result['public_id']

    # ─── Vision Classification ─────────────────────────────────────────

    def _encode_image_base64(self, image_path: Path) -> str:
        """Read an image file and return base64-encoded string."""
        with open(image_path, 'rb') as f:
            return base64.b64encode(f.read()).decode('utf-8')

    def classify_viewpoint(self, image_path: Path, file_id: str) -> ViewpointResult:
        """
        Classify a single image's viewpoint using GPT-4o Vision.
        Uses detail:low for minimal token usage (~85 tokens/image).
        """
        image_base64 = self._encode_image_base64(image_path)

        ext = image_path.suffix.lower()
        mime_map = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                    '.webp': 'image/webp', '.gif': 'image/gif'}
        mime_type = mime_map.get(ext, 'image/jpeg')

        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Classify this product photo's camera viewpoint. "
                            "Return JSON only: {\"viewpoint\": \"<label>\", \"confidence\": <0.0-1.0>}\n"
                            "Labels: front-view, side-view, back-view, sole-view, "
                            "overhead-view, inside-view, on-feet, detail-view"
                        )
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{mime_type};base64,{image_base64}",
                                    "detail": "low"
                                }
                            }
                        ]
                    }
                ],
                max_tokens=50,
                temperature=0.1,
                response_format={"type": "json_object"}
            )

            u = response.usage
            cost = (u.prompt_tokens / 1_000_000 * 2.50) + (u.completion_tokens / 1_000_000 * 10.00)
            self._run_tokens += u.total_tokens
            self._run_cost += cost
            logger.info(
                f"[COST][Agent4] img={image_path.name} prompt={u.prompt_tokens} "
                f"completion={u.completion_tokens} total={u.total_tokens} est_cost=${cost:.5f}"
            )

            result = json.loads(response.choices[0].message.content)
            viewpoint = result.get('viewpoint', 'detail-view').lower().strip()
            confidence = float(result.get('confidence', 0.5))

            if viewpoint not in VIEWPOINTS:
                logger.warning(f"[VISION] Unknown viewpoint '{viewpoint}' for {image_path.name}, defaulting to detail-view")
                viewpoint = 'detail-view'

            logger.info(f"[VISION] {image_path.name} -> {viewpoint} (confidence: {confidence:.2f})")
            return ViewpointResult(
                file_id=file_id,
                original_name=image_path.name,
                viewpoint=viewpoint,
                confidence=confidence
            )

        except Exception as e:
            logger.warning(f"[VISION] Classification failed for {image_path.name}: {e}, defaulting to detail-view")
            return ViewpointResult(
                file_id=file_id,
                original_name=image_path.name,
                viewpoint='detail-view',
                confidence=0.0
            )

    # ─── Compression Pipeline ──────────────────────────────────────────

    def compress_to_webp(
        self,
        input_path: Path,
        output_path: Path,
        target_width: int = None,
        quality: int = None
    ) -> Tuple[int, int]:
        """
        Compress an image to WebP format with iterative quality reduction.

        Returns:
            Tuple of (original_bytes, compressed_bytes)
        """
        target_width = target_width or self.TARGET_WIDTH
        quality = quality or self.WEBP_QUALITY
        original_bytes = input_path.stat().st_size

        with Image.open(input_path) as img:
            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')

            if img.width > target_width:
                ratio = target_width / img.width
                new_height = int(img.height * ratio)
                img = img.resize((target_width, new_height), Image.LANCZOS)

            current_quality = quality
            buffer = io.BytesIO()

            while current_quality >= self.WEBP_MIN_QUALITY:
                buffer.seek(0)
                buffer.truncate()
                img.save(buffer, format='WEBP', quality=current_quality, optimize=True)
                if buffer.tell() <= self.MAX_FILE_SIZE:
                    break
                current_quality -= 5

            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'wb') as f:
                f.write(buffer.getvalue())

        compressed_bytes = output_path.stat().st_size
        logger.debug(
            f"[COMPRESS] {input_path.name}: {original_bytes:,} -> {compressed_bytes:,} bytes "
            f"(q={current_quality}, {compressed_bytes/original_bytes*100:.0f}%)"
        )
        return original_bytes, compressed_bytes

    # ─── SEO Filename Generation ───────────────────────────────────────

    def generate_seo_filename(
        self,
        slug: str,
        viewpoint: str,
        viewpoint_counts: Dict[str, int]
    ) -> str:
        """
        Generate SEO-rich filename with viewpoint label.
        Handles duplicate viewpoints by appending -2, -3 suffix.
        """
        count = viewpoint_counts.get(viewpoint, 0) + 1
        viewpoint_counts[viewpoint] = count

        if count == 1:
            return f"{slug}-{viewpoint}.webp"
        else:
            return f"{slug}-{viewpoint}-{count}.webp"

    # ─── Main Pipeline ─────────────────────────────────────────────────

    def process_product(self, row_data: dict) -> OptimizationResult:
        """
        Process a single product through the full media optimization pipeline.

        Pipeline:
        1. List images from Cloudinary (or Drive)
        2. Download locally
        3. Classify each image viewpoint via GPT-4o Vision
        4. Compress each to WebP (1000px wide, <100KB)
        5. Generate SEO filenames with viewpoint labels
        6. Delete originals from storage
        7. Upload WebP versions back to storage
        8. Return results for database update
        """
        # Support both snake_case (Supabase) and PascalCase (legacy)
        product_id = row_data.get('product_id') or row_data.get('Product_ID', 'UNKNOWN')
        seo_slug = row_data.get('seo_slug') or row_data.get('SEO_Slug', '')

        logger.info(f"[PROCESS] Starting media optimization for {product_id}")

        if not seo_slug:
            return OptimizationResult(
                images_processed=0, images_compressed=0,
                total_original_bytes=0, total_compressed_bytes=0,
                compression_ratio=0.0, viewpoint_labels={},
                new_main_image_id='', webp_image_count=0,
                optimized_at=datetime.now(timezone.utc).isoformat(),
                status='OPTIMIZE_FAILED',
                notes="Missing required field: seo_slug"
            )

        return self._process_cloudinary(product_id, seo_slug, row_data)

    def _process_cloudinary(self, product_id: str, seo_slug: str, row_data: dict) -> OptimizationResult:
        """Process product images via Cloudinary."""
        try:
            # Phase 1: List images in Cloudinary folder
            cloud_files = self._list_cloudinary_images(product_id)
            if not cloud_files:
                return OptimizationResult(
                    images_processed=0, images_compressed=0,
                    total_original_bytes=0, total_compressed_bytes=0,
                    compression_ratio=0.0, viewpoint_labels={},
                    new_main_image_id='', webp_image_count=0,
                    optimized_at=datetime.now(timezone.utc).isoformat(),
                    status='OPTIMIZE_FAILED',
                    notes="No images found in Cloudinary folder"
                )

            # Skip if already optimized (all WebP)
            all_webp = all(f['format'] == 'webp' for f in cloud_files)
            if all_webp:
                logger.info(f"[PROCESS] All images already WebP - skipping {product_id}")
                existing_main = row_data.get('main_image_id') or row_data.get('Main_Image_File_ID', '')
                return OptimizationResult(
                    images_processed=len(cloud_files), images_compressed=0,
                    total_original_bytes=0, total_compressed_bytes=0,
                    compression_ratio=1.0, viewpoint_labels={},
                    new_main_image_id=existing_main,
                    webp_image_count=len(cloud_files),
                    optimized_at=datetime.now(timezone.utc).isoformat(),
                    status='PUBLISHED',
                    notes="Already optimized (WebP)"
                )

            logger.info(f"[PROCESS] Found {len(cloud_files)} images to optimize")

            local_dir = self.tmp_dir / product_id
            local_dir.mkdir(parents=True, exist_ok=True)

            downloaded = []
            for f in cloud_files:
                # Skip and delete the main/hero research-only image.
                # Match by stem (not full filename) to handle jpg/jpeg/png variants.
                stem = Path(f['id']).stem.lower()   # e.g. "00_main" from public_id
                if stem == '00_main' or stem.endswith('-main'):
                    logger.info(f"[PROCESS] Deleting research-only image: {f['name']}")
                    self._delete_cloudinary_file(f['id'])
                    continue

                local_path = local_dir / f['name']
                if self._download_cloudinary_image(f['id'], local_path):
                    downloaded.append({
                        'file_id': f['id'],
                        'name': f['name'],
                        'local_path': local_path
                    })

            if not downloaded:
                return OptimizationResult(
                    images_processed=0, images_compressed=0,
                    total_original_bytes=0, total_compressed_bytes=0,
                    compression_ratio=0.0, viewpoint_labels={},
                    new_main_image_id='', webp_image_count=0,
                    optimized_at=datetime.now(timezone.utc).isoformat(),
                    status='OPTIMIZE_FAILED',
                    notes="Failed to download any images from Cloudinary"
                )

            # Phase 2: Classify viewpoints via GPT-4o Vision
            logger.info(f"[VISION] Classifying {len(downloaded)} images...")
            for item in downloaded:
                vr = self.classify_viewpoint(item['local_path'], item['file_id'])
                item['viewpoint'] = vr.viewpoint
                item['confidence'] = vr.confidence

            # Phase 3: Compress to WebP and generate SEO filenames
            logger.info(f"[COMPRESS] Compressing {len(downloaded)} images to WebP...")
            total_original = 0
            total_compressed = 0
            viewpoint_counts: Dict[str, int] = {}
            webp_files = []

            # Sort by viewpoint priority: front > overhead > side > back > sole > inside > on-feet > detail
            VIEWPOINT_ORDER = ['front-view', 'overhead-view', 'side-view', 'back-view', 'sole-view', 'inside-view', 'on-feet', 'detail-view']
            downloaded.sort(key=lambda x: (
                VIEWPOINT_ORDER.index(x['viewpoint']) if x['viewpoint'] in VIEWPOINT_ORDER else len(VIEWPOINT_ORDER),
                x['name']
            ))

            for item in downloaded:
                seo_filename = self.generate_seo_filename(
                    seo_slug, item['viewpoint'], viewpoint_counts
                )
                webp_path = local_dir / seo_filename

                try:
                    orig_bytes, comp_bytes = self.compress_to_webp(
                        item['local_path'], webp_path
                    )
                    total_original += orig_bytes
                    total_compressed += comp_bytes
                    webp_files.append({
                        'original_file_id': item['file_id'],
                        'original_name': item['name'],
                        'webp_path': webp_path,
                        'webp_filename': seo_filename,
                        'viewpoint': item['viewpoint']
                    })
                except Exception as e:
                    logger.warning(f"[COMPRESS] Failed for {item['name']}: {e}")

            if not webp_files:
                return OptimizationResult(
                    images_processed=len(downloaded), images_compressed=0,
                    total_original_bytes=total_original, total_compressed_bytes=0,
                    compression_ratio=0.0, viewpoint_labels={},
                    new_main_image_id='', webp_image_count=0,
                    optimized_at=datetime.now(timezone.utc).isoformat(),
                    status='OPTIMIZE_FAILED',
                    notes="All image compressions failed"
                )

            # Phase 4: Delete originals from Cloudinary
            logger.info(f"[CLOUDINARY] Deleting {len(downloaded)} original files...")
            for item in downloaded:
                self._delete_cloudinary_file(item['file_id'])

            # Phase 5: Upload WebP versions to Cloudinary
            logger.info(f"[CLOUDINARY] Uploading {len(webp_files)} WebP files...")
            viewpoint_labels = {}
            new_main_image_id = ''

            for idx, wf in enumerate(webp_files):
                new_public_id = self._upload_cloudinary_file(
                    wf['webp_path'], product_id, wf['webp_filename']
                )
                viewpoint_labels[wf['webp_filename']] = wf['viewpoint']

                # First file (front-view sorted first) becomes the new hero
                if idx == 0:
                    new_main_image_id = new_public_id

            # Phase 6: Cleanup local temp files
            shutil.rmtree(local_dir, ignore_errors=True)

            compression_ratio = (
                total_compressed / total_original if total_original > 0 else 0.0
            )
            savings_kb = (total_original - total_compressed) / 1024
            logger.info(
                f"[PROCESS] Complete: {len(webp_files)} WebP files, "
                f"saved {savings_kb:.0f}KB ({(1-compression_ratio)*100:.0f}% reduction)"
            )

            return OptimizationResult(
                images_processed=len(downloaded),
                images_compressed=len(webp_files),
                total_original_bytes=total_original,
                total_compressed_bytes=total_compressed,
                compression_ratio=round(compression_ratio, 3),
                viewpoint_labels=viewpoint_labels,
                new_main_image_id=new_main_image_id,
                webp_image_count=len(webp_files),
                optimized_at=datetime.now(timezone.utc).isoformat(),
                status='PUBLISHED',
                notes=f"Compressed {len(webp_files)} images, saved {savings_kb:.0f}KB"
            )

        except Exception as e:
            logger.error(f"[PROCESS] Failed for {product_id}: {e}")
            local_dir = self.tmp_dir / product_id
            if local_dir.exists():
                shutil.rmtree(local_dir, ignore_errors=True)
            return OptimizationResult(
                images_processed=0, images_compressed=0,
                total_original_bytes=0, total_compressed_bytes=0,
                compression_ratio=0.0, viewpoint_labels={},
                new_main_image_id='', webp_image_count=0,
                optimized_at=datetime.now(timezone.utc).isoformat(),
                status='OPTIMIZE_FAILED',
                notes=str(e)[:200]
            )

