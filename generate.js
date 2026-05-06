const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const GITHUB_ENDPOINT = 'https://models.github.ai/inference/chat/completions';
const GITHUB_CATALOG_ENDPOINT = 'https://models.github.ai/catalog/models';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

const IMAGE_SYSTEM_PROMPT = [
  'You are an image generation model endpoint.',
  'Return the generated or edited image directly in the response.',
  'Do not only describe the image. Do not only return an improved prompt.',
  'If text is included, keep it brief and make sure image output is included.'
].join(' ');

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const provider = payload.provider || 'openrouter';
    const model = String(payload.model || '').trim();
    const prompt = String(payload.prompt || '').trim();

    if (!model) {
      res.status(400).json({ ok: false, error: 'Missing model' });
      return;
    }

    if (!prompt) {
      res.status(400).json({ ok: false, error: 'Missing prompt' });
      return;
    }

    if (provider === 'openrouter') {
      await handleOpenRouter(req, res, payload, model, prompt);
      return;
    }

    if (provider === 'github') {
      await handleGitHub(req, res, payload, model, prompt);
      return;
    }

    if (provider === 'custom') {
      await handleCustom(req, res, payload, model, prompt);
      return;
    }

    res.status(400).json({ ok: false, error: `Unsupported provider: ${provider}` });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || 'Generation failed'
    });
  }
}

async function handleOpenRouter(req, res, payload, model, prompt) {
  const apiKey = readSecret(payload.apiKey, process.env.OPENROUTER_API_KEY);
  if (!apiKey) {
    res.status(401).json({ ok: false, error: 'Missing OpenRouter API key' });
    return;
  }

  const body = {
    model,
    messages: [
      { role: 'system', content: IMAGE_SYSTEM_PROMPT },
      { role: 'user', content: buildUserContent(prompt, payload.image) }
    ],
    modalities: ['image', 'text']
  };

  const upstream = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': requestOrigin(req),
      'X-Title': 'MelChat Image Generator'
    },
    body: JSON.stringify(body)
  });

  await sendGenerationResponse(res, upstream, model);
}

async function handleGitHub(req, res, payload, model, prompt) {
  const apiKey = readSecret(payload.apiKey, process.env.GITHUB_TOKEN);
  if (!apiKey) {
    res.status(401).json({ ok: false, error: 'Missing GitHub token' });
    return;
  }

  const capability = await getGitHubImageCapability(model);
  if (!capability.supportsImageOutput) {
    res.status(400).json({
      ok: false,
      error: '该 GitHub Models 模型当前不支持图片输出，请改用 OpenRouter 图像模型。',
      details: capability.details
    });
    return;
  }

  const body = {
    model,
    messages: [
      { role: 'system', content: IMAGE_SYSTEM_PROMPT },
      { role: 'user', content: buildUserContent(prompt, payload.image) }
    ],
    modalities: ['image', 'text']
  };

  const upstream = await fetch(GITHUB_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify(body)
  });

  await sendGenerationResponse(res, upstream, model);
}

async function handleCustom(req, res, payload, model, prompt) {
  const baseUrl = String(payload.baseUrl || '').trim().replace(/\/$/, '');
  if (!baseUrl) {
    res.status(400).json({ ok: false, error: 'Missing custom baseUrl' });
    return;
  }

  const headers = { 'Content-Type': 'application/json' };
  const apiKey = readSecret(payload.apiKey);
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body = {
    model,
    messages: [
      { role: 'system', content: IMAGE_SYSTEM_PROMPT },
      { role: 'user', content: buildUserContent(prompt, payload.image) }
    ],
    modalities: ['image', 'text']
  };

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  await sendGenerationResponse(res, upstream, model);
}

function buildUserContent(prompt, image) {
  if (!image?.dataUrl) return prompt;

  return [
    { type: 'text', text: prompt },
    {
      type: 'image_url',
      image_url: {
        url: image.dataUrl
      }
    }
  ];
}

function readSecret(...values) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

async function sendGenerationResponse(res, upstream, model) {
  const raw = await upstream.text();
  let data = null;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!upstream.ok) {
    res.status(upstream.status).json({
      ok: false,
      error: extractUpstreamError(data, raw),
      details: raw
    });
    return;
  }

  const message = data?.choices?.[0]?.message || {};
  const text = extractText(message);
  const images = extractImages(message, text);

  if (images.length === 0) {
    res.status(502).json({
      ok: false,
      error: '模型没有返回图片。请确认模型支持 image output，或换用 OpenRouter 图像模型。',
      details: raw
    });
    return;
  }

  res.status(200).json({
    ok: true,
    images,
    text,
    model
  });
}

function extractText(message) {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function extractImages(message, text) {
  const images = [];

  for (const image of message.images || []) {
    const url = image?.image_url?.url || image?.url || image;
    if (typeof url === 'string' && url) images.push(url);
  }

  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      const url = part?.image_url?.url || part?.url;
      if (typeof url === 'string' && url) images.push(url);
    }
  }

  const markdownImage = /!\[[^\]]*]\(([^)\s]+)\)/g;
  let match;
  while ((match = markdownImage.exec(text || '')) !== null) {
    images.push(match[1]);
  }

  const bareImageUrl = /(https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^\s"'<>]*)?|data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+)/g;
  while ((match = bareImageUrl.exec(text || '')) !== null) {
    images.push(match[1]);
  }

  return [...new Set(images)];
}

function extractUpstreamError(data, raw) {
  return data?.error?.message || data?.message || raw || 'Upstream request failed';
}

async function getGitHubImageCapability(modelId) {
  try {
    const response = await fetch(GITHUB_CATALOG_ENDPOINT, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!response.ok) {
      return { supportsImageOutput: false, details: 'Cannot read GitHub Models catalog.' };
    }

    const catalog = await response.json();
    const model = catalog.find((item) => item.id === modelId);
    if (!model) {
      return { supportsImageOutput: false, details: 'Model not found in GitHub Models catalog.' };
    }

    const output = model.supported_output_modalities || [];
    return {
      supportsImageOutput: output.includes('image'),
      details: `supported_output_modalities: ${output.join(', ') || 'none'}`
    };
  } catch (error) {
    return { supportsImageOutput: false, details: error.message };
  }
}

function requestOrigin(req) {
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${protocol}://${host}`;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}
