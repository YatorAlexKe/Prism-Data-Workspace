function getLLMConfig() {
  return {
    provider: document.getElementById('llm-provider').value,
    model: document.getElementById('llm-model').value.trim() || null,
    api_key: document.getElementById('llm-apikey').value.trim() || null
  };
}

function onProviderChange() {
  const v = document.getElementById('llm-provider').value;
  document.getElementById('llm-apikey').style.display = v === 'ollama' ? 'none' : 'inline-block';
  document.getElementById('llm-model').placeholder =
    v === 'openai' ? 'gpt-4o-mini'
    : v === 'anthropic' ? 'claude-haiku-4-5-20251001'
    : 'llama3.2';
}
