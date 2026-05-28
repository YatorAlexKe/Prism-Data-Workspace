import io
import os
import sys
import pandas as pd

# Allow overriding the Tesseract binary location for Windows installs that
# don't put tesseract.exe on PATH (common with the UB-Mannheim build).
TESSERACT_PATH = os.getenv('TESSERACT_PATH')
if TESSERACT_PATH:
    try:
        import pytesseract
        pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH
    except ImportError:
        pass


# Cap the longest side of the preprocessed image so a 2× upscale doesn't blow
# up memory on already-large screenshots.
MAX_PREPROCESS_DIM = 4000

# Table region must occupy at least this fraction of the image to be considered
# a real table (rather than e.g. a single rectangular border around something).
MIN_TABLE_AREA_RATIO = 0.03

# If the detected bbox covers ≥ this fraction of the image, cropping saves
# little and risks clipping borders. Treat as "no useful region" so the caller
# falls through to full-image OCR. Set conservatively — table-only screenshots
# typically have the table at >90% of the canvas.
NEAR_FULL_IMAGE_RATIO = 0.85

# Pad the detected bbox so we don't clip the outermost border line of the
# table AND so img2table has whitespace around the table for its own detection
# heuristics to lock onto. Image-dimension based (not bbox-based) so padding
# stays meaningful even when the bbox is small.
TABLE_CROP_PAD_MIN_PX = 20
TABLE_CROP_PAD_IMG_RATIO = 0.025


def detect_table_bbox(pil_image) -> tuple | None:
    """Locate the largest ruled-table region in a PIL image using OpenCV
    morphology.

    Returns ((x, y, w, h), line_density) or None if no plausible table region
    was found. Works well for tables with visible horizontal AND vertical
    rules; returns None for borderless tables (which means the caller falls
    back to the full image)."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return None

    arr = np.array(pil_image.convert('L'))
    H, W = arr.shape

    # Pass 1: high-contrast borders via global Otsu. Fast, clean, no noise on
    # plain backgrounds — handles pure-black tables and most screenshots.
    _, binary_otsu = cv2.threshold(arr, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    bbox = _find_largest_grid_region(binary_otsu, W, H)
    if bbox is not None:
        return bbox

    # Pass 2: low-contrast borders via local adaptive thresholding. Used only
    # when Otsu found nothing — typically thin grey/colored rules on white
    # (web-style tables in screenshots). Pre-blur with a small kernel so
    # per-pixel anti-aliasing noise doesn't survive into the line mask and
    # create spurious "lines" in text regions.
    blurred = cv2.GaussianBlur(arr, (3, 3), 0)
    binary_adaptive = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV,
        blockSize=25, C=5,
    )
    return _find_largest_grid_region(binary_adaptive, W, H)


def _find_largest_grid_region(binary, W: int, H: int) -> tuple | None:
    """Given a binary image where rules show as foreground, return the bbox of
    the largest connected grid region or None if no plausible region exists."""
    import cv2

    # Detect long horizontal lines: erode with a wide-but-thin kernel, then
    # dilate. Kernel length ~ 1/30 of the image dimension — shorter than that
    # and we'd pick up underlined text.
    h_kernel_len = max(20, W // 30)
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (h_kernel_len, 1))
    h_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, h_kernel, iterations=1)

    v_kernel_len = max(20, H // 30)
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, v_kernel_len))
    v_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, v_kernel, iterations=1)

    # Tables have both long horizontal AND long vertical rules.
    grid = cv2.bitwise_or(h_lines, v_lines)
    contours, _ = cv2.findContours(grid, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    best = max(contours, key=lambda c: cv2.boundingRect(c)[2] * cv2.boundingRect(c)[3])
    x, y, bw, bh = cv2.boundingRect(best)
    img_area = W * H
    region_area = bw * bh

    # Too small → not a real table (more likely a small decorative box).
    if region_area < img_area * MIN_TABLE_AREA_RATIO:
        return None

    # Too big → this pass didn't actually localize a table, it just shaded
    # most of the image. Treat as a miss so the caller can try the next pass
    # or fall through to full-image OCR.
    if region_area >= img_area * NEAR_FULL_IMAGE_RATIO:
        return None

    region = grid[y:y + bh, x:x + bw]
    density = float(cv2.countNonZero(region)) / float(region_area)
    if density < 0.003:
        return None

    return (x, y, bw, bh), density


def preprocess_image(content: bytes, *, isolate_table: bool = True) -> bytes:
    """EXIF-rotate → (isolate table) → grayscale → autocontrast → resize.

    Resize: long side targets min(2 × original, MAX_PREPROCESS_DIM) — upscales
    small images, downscales oversized ones.

    If isolate_table is True, crop to the detected table region before OCR so
    surrounding paragraph text doesn't pollute img2table's row/column inference.
    Detection is non-destructive: if no clear region is found, we fall back to
    the full image. Disable for borderless tables (no rules to detect)."""
    from PIL import Image, ImageOps

    img = Image.open(io.BytesIO(content))
    orig_size = img.size
    # Honor EXIF orientation — phone photos commonly come in rotated by 90°.
    img = ImageOps.exif_transpose(img)
    after_exif = img.size

    crop_info = "off"
    if isolate_table:
        bbox = detect_table_bbox(img)
        if bbox is not None:
            (x, y, bw, bh), density = bbox
            # Padding scales with image size, not bbox size. Keeps img2table's
            # detection heuristics happy by giving the table some whitespace
            # margin even when the bbox is large.
            img_w, img_h = img.size
            pad = max(TABLE_CROP_PAD_MIN_PX, int(min(img_w, img_h) * TABLE_CROP_PAD_IMG_RATIO))
            x0 = max(0, x - pad)
            y0 = max(0, y - pad)
            x1 = min(img_w, x + bw + pad)
            y1 = min(img_h, y + bh + pad)
            img = img.crop((x0, y0, x1, y1))
            crop_info = f"bbox=({x},{y},{bw},{bh}) density={density:.3f} pad={pad}"
        else:
            crop_info = "no_region"

    if img.mode != 'L':
        img = img.convert('L')
    img = ImageOps.autocontrast(img)

    w, h = img.size
    target_long = min(max(w, h) * 2, MAX_PREPROCESS_DIM)
    scale = target_long / max(w, h)
    if scale != 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

    print(
        f"[image_ocr] preprocess: input={orig_size} after_exif={after_exif} "
        f"after_isolate={(w, h)} final={img.size} scale={scale:.2f} crop={crop_info}",
        file=sys.stderr,
        flush=True,
    )

    out = io.BytesIO()
    img.save(out, format='PNG')
    return out.getvalue()


def extract_tables_from_image(
    content: bytes,
    *,
    min_confidence: int = 25,
    lang: str = 'eng',
    has_header: bool = True,
    preprocess: bool = True,
    implicit_rows: bool = False,
    isolate_table: bool = True,
    unwrap_lines: bool = True,
) -> list:
    """OCR an image and return every detected table as a pandas DataFrame.

    Args:
        content: image bytes.
        min_confidence: cells with mean OCR confidence below this percentage
            are dropped. Lower → more captured, more noise.
        lang: Tesseract language code (e.g. 'eng', 'fra', 'eng+fra').
        has_header: if True, promote the first detected row to column names.
            If False, columns stay as 0, 1, 2, … and the user can rename later.
        preprocess: if True, grayscale + autocontrast + upscale before OCR.
        implicit_rows: if True, img2table infers extra row boundaries AND
            borderless tables from text positions. Enable for borderless
            tables; leave off for ruled tables (the default) because text
            positions inside wrapped cells get misread as separate rows.
        isolate_table: if True, detect the ruled-table bounding box and crop
            to it before OCR. Strips surrounding paragraph text that would
            otherwise pollute img2table's row/column inference. No-op for
            borderless tables (no rules to detect → falls back to full image).
        unwrap_lines: if True, post-process cell text to glue short lowercase
            continuation fragments back onto the preceding word — recovers
            wrapped content like "Manchest\\ner" → "Manchester" and headers
            like "Departme\\nnt" → "Department". Applied to all cells before
            the header row is promoted, so headers benefit too.

    Raises:
        RuntimeError: if img2table / pytesseract isn't installed, or if the
            Tesseract binary / language pack can't be located.
    """
    try:
        from img2table.document import Image
        from img2table.ocr import TesseractOCR
    except ImportError as e:
        raise RuntimeError(
            "Image OCR requires extra packages. Install with: "
            "pip install img2table pytesseract opencv-python-headless"
        ) from e

    try:
        ocr = TesseractOCR(n_threads=1, lang=lang)
    except Exception as e:
        raise RuntimeError(
            f"Tesseract not available for lang='{lang}'. Install Tesseract OCR "
            "(Windows: https://github.com/UB-Mannheim/tesseract/wiki), make sure "
            "the requested language pack is present, and set TESSERACT_PATH if "
            "tesseract.exe is not on PATH."
        ) from e

    # Couple borderless detection to implicit_rows. Both are different facets
    # of "infer table structure from text positions rather than visible rules".
    # Decoupling them means borderless detection still fires on ruled tables
    # with wrapped cell content — text lines inside cells get read as separate
    # "rows" and that bogus table comes back first via table_index=0.
    borderless_tables = implicit_rows

    def _run_ocr(processed_bytes):
        d = Image(src=io.BytesIO(processed_bytes))
        try:
            return d.extract_tables(
                ocr=ocr,
                implicit_rows=implicit_rows,
                borderless_tables=borderless_tables,
                min_confidence=min_confidence,
            )
        except Exception as e:
            raise RuntimeError(f"OCR failed: {e}") from e

    if preprocess:
        processed = preprocess_image(content, isolate_table=isolate_table)
    else:
        processed = content

    extracted = _run_ocr(processed)

    # Safety net: if isolation was on and yielded nothing (tight crop confused
    # img2table, detector picked the wrong region, etc.), retry on the
    # un-isolated full image. Guarantees we never do worse than the pre-feature
    # baseline. Costs one extra OCR run only on the failure path.
    if not extracted and isolate_table and preprocess:
        print(
            "[image_ocr] cropped extraction yielded 0 tables; retrying with isolate_table=False",
            file=sys.stderr, flush=True,
        )
        processed = preprocess_image(content, isolate_table=False)
        extracted = _run_ocr(processed)

    print(f"[image_ocr] extracted {len(extracted)} table(s)", file=sys.stderr, flush=True)

    dataframes = []
    for tbl in extracted:
        df = getattr(tbl, 'df', None)
        if df is None or df.empty:
            continue
        if unwrap_lines:
            # Apply BEFORE header promotion so the header row gets healed too —
            # turns "Departme\nnt" into "Department" so sanitize_column_name
            # doesn't produce "departme_nt".
            df = df.apply(lambda col: col.map(_collapse_wrapped_lines))
        if has_header:
            df = _promote_first_row_to_header(df)
        dataframes.append(df)

    return dataframes


def _collapse_wrapped_lines(value):
    """Glue short lowercase continuation fragments onto the preceding word.

    OCR loses the "this was a wrap break" signal — a wrapped "Manchester"
    arrives as "Manchest\\ner" or "Manchest er" and there's no way to tell
    that apart from a legitimate two-word phrase like "New York" by looking
    at the string alone. The heuristic: any whitespace-separated fragment
    that is ≤2 chars AND entirely lowercase is almost certainly a wrap
    continuation. Real two-word phrases in tabular data ("First name",
    "John Smith", "New York") have longer or capitalized second tokens.

    Acknowledged false positive: short-word phrases like "yes no" collapse
    to "yesno". Rare in tabular data; users can disable via unwrap_lines.
    """
    if not isinstance(value, str):
        return value
    parts = value.split()
    if len(parts) <= 1:
        return value
    out = []
    for part in parts:
        if out and len(part) <= 2 and part.islower():
            out[-1] += part
        else:
            out.append(part)
    return ' '.join(out)


def _promote_first_row_to_header(df: pd.DataFrame) -> pd.DataFrame:
    """Move row 0 into the column index. Called unconditionally when the
    caller asserts the image has a header row — no guessing.

    Empty cells get placeholder names so we don't end up with two columns
    named ''; clean_dataframe handles any remaining duplicates."""
    if df.empty:
        return df
    df = df.copy()
    raw = [str(v).strip() for v in df.iloc[0].fillna('').astype(str).tolist()]
    df.columns = [name if name else f'col_{i}' for i, name in enumerate(raw)]
    return df.iloc[1:].reset_index(drop=True)
