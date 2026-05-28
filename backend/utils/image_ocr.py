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


def preprocess_image(content: bytes) -> bytes:
    """EXIF-rotate → grayscale → autocontrast → resize, returned as PNG bytes.

    Resize behavior: target a long side of min(2 × original, MAX_PREPROCESS_DIM).
    That both upscales small images (better OCR) and downscales oversized ones
    (phone photos, 4K screenshots) so img2table/OpenCV doesn't blow up memory.
    Tesseract accuracy improves with cleaner pixels and more samples per
    character, so we always run this before OCR."""
    from PIL import Image, ImageOps

    img = Image.open(io.BytesIO(content))
    orig_size = img.size
    # Honor EXIF orientation — phone photos commonly come in rotated by 90°.
    img = ImageOps.exif_transpose(img)
    if img.mode != 'L':
        img = img.convert('L')
    img = ImageOps.autocontrast(img)

    w, h = img.size
    target_long = min(max(w, h) * 2, MAX_PREPROCESS_DIM)
    scale = target_long / max(w, h)
    if scale != 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

    print(
        f"[image_ocr] preprocess: input={orig_size} after_exif={(w, h)} "
        f"final={img.size} scale={scale:.2f}",
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
        implicit_rows: if True, img2table infers extra row boundaries from
            text positions (good for borderless tables, bad for ruled tables
            with wrapped cell content — splits one cell across two rows).

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

    if preprocess:
        content = preprocess_image(content)

    doc = Image(src=io.BytesIO(content))
    try:
        extracted = doc.extract_tables(
            ocr=ocr,
            implicit_rows=implicit_rows,
            borderless_tables=True,
            min_confidence=min_confidence,
        )
    except Exception as e:
        raise RuntimeError(f"OCR failed: {e}") from e

    print(f"[image_ocr] extracted {len(extracted)} table(s)", file=sys.stderr, flush=True)

    dataframes = []
    for tbl in extracted:
        df = getattr(tbl, 'df', None)
        if df is None or df.empty:
            continue
        if has_header:
            df = _promote_first_row_to_header(df)
        dataframes.append(df)

    return dataframes


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
