from fastapi import APIRouter
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from utils.llm import list_ollama_models, KNOWN_OLLAMA_MODELS, DEFAULT_OLLAMA_MODEL, LLMUnavailable

router = APIRouter()


@router.get("/llm/models")
async def get_models():
    """Local models for the model picker: installed ones first, then known
    models that aren't installed yet (with the command to get them)."""
    try:
        installed = list_ollama_models()
    except LLMUnavailable as e:
        return {"available": False, "error": str(e), "default": DEFAULT_OLLAMA_MODEL, "models": []}

    names = {m["name"] for m in installed}
    models = [{**m, "installed": True, "tag": KNOWN_OLLAMA_MODELS.get(m["name"])} for m in installed]
    models += [{"name": n, "installed": False, "tag": tag, "pull": f"ollama pull {n}"}
               for n, tag in KNOWN_OLLAMA_MODELS.items() if n not in names]
    # Recommended first, then lighter, then everything else alphabetically.
    order = {"recommended": 0, "lighter": 1}
    models.sort(key=lambda m: (not m["installed"], order.get(m["tag"], 2), m["name"]))
    return {"available": True, "default": DEFAULT_OLLAMA_MODEL, "models": models}
