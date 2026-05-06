const PRESET_MODELS = [
  {
    id: 'openai/gpt-4o',
    name: 'OpenAI GPT-4o',
    provider: 'openrouter',
    supportsTextToImage: true,
    supportsImageToImage: true,
    source: 'preset'
  },
  {
    id: 'qwen/qwen-image',
    name: 'Qwen Image',
    provider: 'openrouter',
    supportsTextToImage: true,
    supportsImageToImage: true,
    source: 'preset'
  },
  {
    id: 'janus-4o',
    name: 'Janus-4o',
    provider: 'openrouter',
    supportsTextToImage: true,
    supportsImageToImage: true,
    source: 'preset'
  },
  {
    id: 'black-forest-labs/flux.2-klein-4b',
    name: 'Flux.2 Klein 4B',
    provider: 'openrouter',
    supportsTextToImage: true,
    supportsImageToImage: false,
    source: 'preset'
  }
];

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const models = [...PRESET_MODELS];

  try {
    const githubModels = await fetch('https://models.github.ai/catalog/models', {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (githubModels.ok) {
      const catalog = await githubModels.json();
      for (const model of catalog) {
        const input = model.supported_input_modalities || [];
        const output = model.supported_output_modalities || [];
        if (!input.includes('image') && !output.includes('image')) continue;

        models.push({
          id: model.id,
          name: model.name || model.id,
          provider: 'github',
          supportsTextToImage: output.includes('image'),
          supportsImageToImage: input.includes('image') && output.includes('image'),
          source: 'github-catalog'
        });
      }
    }
  } catch {
    // Keep the static presets usable when the public catalog is unavailable.
  }

  res.status(200).json({ models: dedupeModels(models) });
}

function dedupeModels(models) {
  const seen = new Set();
  return models.filter((model) => {
    const key = `${model.provider}:${model.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}
