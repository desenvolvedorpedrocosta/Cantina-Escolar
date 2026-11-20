import { API_URL } from './config.js';

export class ApiError extends Error {
  constructor(message, payload = null) {
    super(message);
    this.name = 'ApiError';
    this.payload = payload;
  }
}

export function urlConfigurada() {
  return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(API_URL);
}

export async function apiRequest(payload, options = {}) {
  if (!urlConfigurada()) {
    throw new ApiError('Configure o endereço do Web App no arquivo js/config.js.');
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeout || 30000);

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        // text/plain evita a requisição preflight application/json.
        // O corpo continua sendo JSON e é lido pelo Apps Script em e.postData.contents.
        'Content-Type': 'text/plain;charset=UTF-8'
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store'
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('A comunicação demorou demais. A operação pode ser reenviada com segurança.');
      timeoutError.name = 'NetworkError';
      throw timeoutError;
    }
    const networkError = new Error('Não foi possível alcançar o servidor. Verifique a conexão.');
    networkError.name = 'NetworkError';
    networkError.originalError = error;
    throw networkError;
  } finally {
    window.clearTimeout(timeout);
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    const parseError = new Error('O servidor respondeu em formato inesperado. Verifique a implantação do Web App.');
    parseError.name = 'ApiError';
    throw parseError;
  }

  if (!response.ok) {
    throw new ApiError(`Erro HTTP ${response.status}.`, result);
  }

  if (!result || result.sucesso !== true) {
    throw new ApiError(result?.mensagem || 'Não foi possível concluir a operação.', result);
  }

  return result.dados;
}
